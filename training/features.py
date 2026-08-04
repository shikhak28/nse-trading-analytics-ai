"""Leakage-safe candle feature computation. compute_features(df) is the single
function every consumer (backfill, training, future live scoring) must call --
never reimplement this logic elsewhere, or training/serving feature code will
drift apart.

Input: a DataFrame of one symbol's daily candles, columns
[candle_timestamp, open, high, low, close, volume], sorted ascending.

Output: a DataFrame indexed by candle_timestamp with one feature vector per
day, computed using only that day's candle and earlier ones (every rolling
window is naturally trailing; nothing peeks at a future close). Rows without
enough history for a given window are NaN for that column, not dropped here --
callers decide how to handle NaNs (usually: drop before training).
"""

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "ret_1", "log_ret_1", "ret_5", "ret_20", "gap_pct",
    "roll_mean_5", "roll_std_5", "roll_mean_20", "roll_std_20",
    "atr_14", "rsi_14", "macd", "macd_signal", "macd_hist", "adx_14",
    "vwap_dist_20", "bb_percent_b_20", "momentum_10", "realized_vol_20",
    "price_acceleration", "trend_slope_20", "trend_r2_20",
]


def _rsi(close, window=14):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _true_range(high, low, close):
    prev_close = close.shift(1)
    return pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)


def _adx(high, low, close, window=14):
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr = _true_range(high, low, close)
    atr = tr.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=high.index).ewm(alpha=1 / window, min_periods=window, adjust=False).mean() / atr
    minus_di = 100 * pd.Series(minus_dm, index=high.index).ewm(alpha=1 / window, min_periods=window, adjust=False).mean() / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()


def _rolling_trend(close, window=20):
    x = np.arange(window)
    x_mean = x.mean()
    x_centered = x - x_mean
    denom = (x_centered ** 2).sum()

    def slope_r2(y):
        y_mean = y.mean()
        y_centered = y - y_mean
        slope = (x_centered * y_centered).sum() / denom
        pred = slope * x_centered + y_mean
        ss_res = ((y - pred) ** 2).sum()
        ss_tot = (y_centered ** 2).sum()
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        return slope / y_mean if y_mean else 0.0, r2

    slopes = close.rolling(window).apply(lambda y: slope_r2(y)[0], raw=False)
    r2s = close.rolling(window).apply(lambda y: slope_r2(y)[1], raw=False)
    return slopes, r2s


def compute_features(df):
    df = df.sort_values("candle_timestamp").reset_index(drop=True)
    open_, high, low, close, volume = df["open"], df["high"], df["low"], df["close"], df["volume"]

    out = pd.DataFrame(index=df.index)
    out["candle_timestamp"] = df["candle_timestamp"]

    out["ret_1"] = close.pct_change(1)
    out["log_ret_1"] = np.log(close / close.shift(1))
    out["ret_5"] = close.pct_change(5)
    out["ret_20"] = close.pct_change(20)
    out["gap_pct"] = (open_ - close.shift(1)) / close.shift(1)

    out["roll_mean_5"] = close.rolling(5).mean() / close - 1
    out["roll_std_5"] = close.rolling(5).std() / close
    out["roll_mean_20"] = close.rolling(20).mean() / close - 1
    out["roll_std_20"] = close.rolling(20).std() / close

    tr = _true_range(high, low, close)
    out["atr_14"] = tr.rolling(14).mean() / close

    out["rsi_14"] = _rsi(close, 14)

    ema_12 = close.ewm(span=12, min_periods=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, min_periods=26, adjust=False).mean()
    macd = ema_12 - ema_26
    macd_signal = macd.ewm(span=9, min_periods=9, adjust=False).mean()
    out["macd"] = macd / close
    out["macd_signal"] = macd_signal / close
    out["macd_hist"] = (macd - macd_signal) / close

    out["adx_14"] = _adx(high, low, close, 14)

    typical_price = (high + low + close) / 3
    vwap_20 = (typical_price * volume).rolling(20).sum() / volume.rolling(20).sum()
    out["vwap_dist_20"] = close / vwap_20 - 1

    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    out["bb_percent_b_20"] = (close - bb_lower) / (bb_upper - bb_lower)

    out["momentum_10"] = (close - close.shift(10)) / close.shift(10)
    out["realized_vol_20"] = out["log_ret_1"].rolling(20).std() * np.sqrt(252)
    out["price_acceleration"] = out["ret_1"].diff()

    slope, r2 = _rolling_trend(close, 20)
    out["trend_slope_20"] = slope
    out["trend_r2_20"] = r2

    out = out.set_index("candle_timestamp")
    return out[FEATURE_COLUMNS]
