"""Verification job: joins pending predictions against realized prices once
they exist and writes prediction_verification rows. This table is the single
source of truth every accuracy/calibration/IC metric elsewhere reads from --
never recompute "was this right" logic anywhere else.

Approximation in scope for this pass: a prediction's reference trading day is
taken as predicted_at's date (predict.py runs same-day, right after that
day's EOD candle has synced). 'next_day' resolves once the following day's
candle exists; 'eod' resolves using that same reference day's own
open/close, which in practice is already known by the time predict.py ran --
acceptable for now since there's no premarket-only scheduling yet (see
design doc's staged rollout).

Usage:
    python verify.py
"""

import db

CLASSIFICATION_TARGETS = {"p_move_up_2pct", "p_move_down_2pct"}
MOVE_THRESHOLD = 0.02


def fetch_next_two_candles(exchange, symbol, reference_date):
    return db.fetch_df(
        """
        SELECT candle_timestamp, open, close
        FROM historical_prices
        WHERE exchange = %s AND symbol = %s AND interval = 'day'
          AND candle_timestamp::date >= %s
        ORDER BY candle_timestamp ASC
        LIMIT 2
        """,
        (exchange, symbol, reference_date),
    )


def verify_row(pred):
    reference_date = pred["predicted_at"].date()
    candles = fetch_next_two_candles(pred["exchange"], pred["symbol"], reference_date)
    if candles.empty:
        return None

    same_day = candles.iloc[0]
    same_day_date = same_day["candle_timestamp"].date()
    if same_day_date != reference_date:
        return None

    if pred["horizon"] == "eod":
        actual_return = float((same_day["close"] - same_day["open"]) / same_day["open"])
    else:
        if len(candles) < 2:
            return None
        next_day = candles.iloc[1]
        actual_return = float(next_day["close"] / same_day["close"] - 1)

    if pred["target_label"] in CLASSIFICATION_TARGETS:
        actual_up = actual_return >= MOVE_THRESHOLD
        actual_down = actual_return <= -MOVE_THRESHOLD
        actual_binary = actual_up if pred["target_label"] == "p_move_up_2pct" else actual_down
        actual_value = float(actual_binary)
        error = actual_value - pred["predicted_value"]
        signal_hit = (pred["predicted_value"] >= 0.5) == actual_binary
    else:
        actual_value = actual_return
        error = actual_value - pred["predicted_value"]
        signal_hit = (pred["predicted_value"] >= 0) == (actual_return >= 0)

    return {
        "prediction_id": int(pred["id"]),
        "prediction_predicted_at": pred["predicted_at"],
        "checkpoint": pred["horizon"],
        "actual_value": actual_value,
        "error": float(error),
        "signal_hit": bool(signal_hit),
        "realized_return": actual_return,
    }


def main():
    for horizon in ["eod", "next_day"]:
        pending = db.fetch_unverified_predictions(horizon)
        print(f"{horizon}: {len(pending)} pending")

        rows = []
        for _, pred in pending.iterrows():
            result = verify_row(pred)
            if result:
                rows.append(result)

        db.insert_verifications(rows)
        print(f"  wrote {len(rows)} verification(s)")


if __name__ == "__main__":
    main()
