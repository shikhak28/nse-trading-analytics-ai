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

# Candidates for v2. They ship alongside v1 without touching it: a v2 model
# only exists once train.py --feature-set v2 is run and then promoted by hand.
STOCK_CANDIDATE_COLUMNS = [
    "volume_ratio_1", "volume_ratio_20", "breakout_4pct", "range_expansion_3",
    "close_location", "above_sma_50",
]
MARKET_CANDIDATE_COLUMNS = [
    "market_ret_1", "breadth_above_50dma", "sector_strength_5", "stock_vs_sector_5",
]

# Candidates for v3: trend strength in plain terms.
TREND_CANDIDATE_COLUMNS = [
    "green_streak",        # days in a row it closed higher (negative = lower)
    "dist_high_20",        # close vs highest high of 20 days (0 = at the high)
    "dist_high_52w",       # same, up to 52 weeks (at least 120 days of data)
    "volume_trend_5_20",   # 5-day avg volume / 20-day avg volume
    "up_down_volume_10",   # log(volume on up days / volume on down days), 10 days
]

TRADED_VALUE_COLUMN = "traded_value_20"

FEATURE_SETS = {
    "v1": FEATURE_COLUMNS,
    "v2": FEATURE_COLUMNS + STOCK_CANDIDATE_COLUMNS + MARKET_CANDIDATE_COLUMNS,
    "v3": FEATURE_COLUMNS + STOCK_CANDIDATE_COLUMNS + MARKET_CANDIDATE_COLUMNS + TREND_CANDIDATE_COLUMNS,
}


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


def _streak(change):
    """Signed run length: +3 = closed higher 3 days running, -2 = lower 2."""
    sign = np.sign(change.fillna(0)).astype(int).to_numpy()
    out = np.zeros(len(sign))
    run = 0
    for i, s in enumerate(sign):
        run = (run + s if run * s > 0 else s) if s != 0 else 0
        out[i] = run
    return pd.Series(out, index=change.index).where(change.notna())


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

    prev_close = close.shift(1)
    prev_volume = volume.shift(1)
    out["volume_ratio_1"] = volume / prev_volume.replace(0, np.nan)
    out["volume_ratio_20"] = volume / volume.rolling(20).mean().shift(1).replace(0, np.nan)
    out["breakout_4pct"] = ((close / prev_close >= 1.04) & (volume > prev_volume)).astype(float).where(prev_close.notna())

    day_range = high - low
    prior_max_range = day_range.shift(1).rolling(3).max()
    out["range_expansion_3"] = (day_range > prior_max_range).astype(float).where(prior_max_range.notna())
    out["close_location"] = (close - low) / day_range.replace(0, np.nan)

    sma_50 = close.rolling(50).mean()
    out["above_sma_50"] = (close > sma_50).astype(float).where(sma_50.notna())

    change = close.diff()
    out["green_streak"] = _streak(change)
    out["dist_high_20"] = close / high.rolling(20).max() - 1
    out["dist_high_52w"] = close / high.rolling(252, min_periods=120).max() - 1
    out["volume_trend_5_20"] = volume.rolling(5).mean() / volume.rolling(20).mean().replace(0, np.nan)
    up_vol = volume.where(change > 0, 0).rolling(10).sum()
    down_vol = volume.where(change < 0, 0).rolling(10).sum()
    out["up_down_volume_10"] = np.log((up_vol + 1) / (down_vol + 1)).where(change.notna())

    # Not a model input: train.py uses it to report results by liquidity.
    out[TRADED_VALUE_COLUMN] = (close * volume).rolling(20).mean()

    out = out.set_index("candle_timestamp")
    return out[FEATURE_COLUMNS + STOCK_CANDIDATE_COLUMNS + TREND_CANDIDATE_COLUMNS + [TRADED_VALUE_COLUMN]]


def add_market_features(df, sectors):
    """Adds the features that need every stock at once. df: rows across all
    symbols with exchange, symbol, candle_timestamp, ret_1, ret_5,
    above_sma_50. sectors: [exchange, symbol, sector]. Each value uses only
    that same day's cross-section, so nothing peeks ahead.
    """
    df = df.merge(sectors, on=["exchange", "symbol"], how="left")
    # Daily candles are stored at 00:00 or 18:30 of the previous day.
    day = (pd.to_datetime(df["candle_timestamp"]) + pd.Timedelta(hours=6)).dt.normalize()

    by_day = df.groupby(day)
    market_ret_5 = by_day["ret_5"].transform("mean")
    sector_ret_5 = df.groupby([day, "sector"])["ret_5"].transform("mean")

    df["market_ret_1"] = by_day["ret_1"].transform("mean")
    df["breadth_above_50dma"] = by_day["above_sma_50"].transform("mean")
    df["sector_strength_5"] = sector_ret_5 - market_ret_5
    df["stock_vs_sector_5"] = df["ret_5"] - sector_ret_5
    return df.drop(columns="sector")
