"""Scores the latest available feature snapshot per symbol with the current
production model, for every (horizon, target_label) that has one, and writes
rows to `predictions`. Meant to run daily on the training machine after
build_dataset.py has picked up the day's new candle.

Usage:
    python predict.py
"""

from datetime import datetime, timezone

import joblib
import pandas as pd

import db
from config import CACHE_DIR, TARGET_LABELS


def predict_for_target(horizon, target):
    model_row = db.fetch_production_model(horizon, target)
    if model_row is None:
        print(f"  no production model for {horizon}/{target}, skipping")
        return

    path = CACHE_DIR / f"{horizon}.parquet"
    if not path.exists():
        print(f"  {path} missing, run build_dataset.py first")
        return
    df = pd.read_parquet(path)
    df["candle_timestamp"] = pd.to_datetime(df["candle_timestamp"])

    latest_per_symbol = df.sort_values("candle_timestamp").groupby("symbol").tail(1)
    if latest_per_symbol.empty:
        return

    from features import FEATURE_COLUMNS
    model = joblib.load(model_row["artifact_path"])
    X = latest_per_symbol[FEATURE_COLUMNS]

    is_classification = target in {"p_move_up_2pct", "p_move_down_2pct"}
    if is_classification:
        proba = model.predict_proba(X)[:, 1]
        predicted_value = proba
        confidence = proba
        predicted_low = predicted_high = [None] * len(proba)
    else:
        pred = model.predict(X)
        predicted_value = pred
        confidence = [None] * len(pred)
        predicted_low = predicted_high = [None] * len(pred)

    now = datetime.now(timezone.utc)
    rows = []
    for i, (_, row) in enumerate(latest_per_symbol.iterrows()):
        rows.append({
            "exchange": row["exchange"],
            "symbol": row["symbol"],
            "predicted_at": now,
            "horizon": horizon,
            "target_label": target,
            "model_version_id": int(model_row["id"]),
            "predicted_value": float(predicted_value[i]),
            "predicted_low": predicted_low[i],
            "predicted_high": predicted_high[i],
            "confidence": float(confidence[i]) if confidence[i] is not None else None,
            "explanation": None,
        })

    db.insert_predictions(rows)
    print(f"  wrote {len(rows)} predictions for {horizon}/{target} (model_version_id={model_row['id']})")


def main():
    for horizon, targets in TARGET_LABELS.items():
        for target in targets:
            print(f"Predicting {horizon}/{target}...")
            predict_for_target(horizon, target)


if __name__ == "__main__":
    main()
