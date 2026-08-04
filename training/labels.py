"""Label definitions, in scope for this pass: 'eod' and 'next_day' horizons
only (see config.py for the exact semantics of each). Same leakage
discipline as features.py -- every label is attributed to the feature
snapshot date it can legitimately be predicted from, never the date whose
own close produced it.
"""

import numpy as np
import pandas as pd

MOVE_THRESHOLD = 0.02


def compute_labels(df):
    """df: one symbol's daily candles, [candle_timestamp, open, high, low,
    close, volume], sorted ascending.

    Returns a dict {horizon: DataFrame indexed by candle_timestamp} where
    the index is the date of the FEATURE SNAPSHOT the label should be joined
    against (i.e. the date features.compute_features would key that
    prediction under), not the date the outcome is realized on.
    """
    df = df.sort_values("candle_timestamp").reset_index(drop=True)
    close = df["close"]
    open_ = df["open"]
    ts = df["candle_timestamp"]

    # next_day: predicted from day t's close-of-day snapshot, resolves at
    # day t+1's close. Attributed to day t (shift(-1) pulls tomorrow's close
    # up onto today's row).
    next_day_return = close.shift(-1) / close - 1
    next_day = pd.DataFrame({
        "candle_timestamp": ts,
        "next_day_return": next_day_return,
        "p_move_up_2pct": (next_day_return >= MOVE_THRESHOLD).astype(float),
        "p_move_down_2pct": (next_day_return <= -MOVE_THRESHOLD).astype(float),
    }).set_index("candle_timestamp")
    # last row has no "tomorrow" yet -- can't have a label.
    next_day.loc[next_day["next_day_return"].isna(), ["p_move_up_2pct", "p_move_down_2pct"]] = np.nan

    # eod: today's (t) own intraday open->close return, but attributed to
    # day t-1's snapshot -- that's the last data a premarket prediction on
    # day t could actually see.
    eod_return_today = (close - open_) / open_
    eod = pd.DataFrame({
        "candle_timestamp": ts.shift(1),
        "eod_return": eod_return_today,
    }).dropna(subset=["candle_timestamp"]).set_index("candle_timestamp")

    return {"eod": eod, "next_day": next_day}
