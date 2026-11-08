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
from explain import build_explainer, compute_shap_batch, top_features_for_row
from features import FEATURE_SETS


def load_todays_snapshot():
    """Newest features of each symbol, for symbols whose newest candle is
    today's. A symbol that didn't sync today is skipped: scoring its old
    candle under today's date would publish a stale prediction as a new one.
    """
    path = CACHE_DIR / "next_day_latest.parquet"
    if not path.exists():
        print(f"  {path} missing, run build_dataset.py first")
        return pd.DataFrame()

    df = pd.read_parquet(path)
    # Daily candles are stored at 00:00 or at 18:30 of the previous day,
    # depending on the timezone of the process that synced them.
    candle_day = (pd.to_datetime(df["candle_timestamp"]) + pd.Timedelta(hours=6)).dt.date
    today = datetime.now(timezone.utc).date()
    fresh = df[candle_day == today]
    print(f"  {len(fresh)} of {len(df)} symbols have today's candle; the rest are skipped")
    return fresh


def load_latest_labelled(horizon):
    path = CACHE_DIR / f"{horizon}.parquet"
    if not path.exists():
        print(f"  {path} missing, run build_dataset.py first")
        return pd.DataFrame()
    df = pd.read_parquet(path)
    df["candle_timestamp"] = pd.to_datetime(df["candle_timestamp"])
    return df.sort_values("candle_timestamp").groupby("symbol").tail(1)


def predict_for_target(horizon, target):
    model_row = db.fetch_production_model(horizon, target)
    if model_row is None:
        print(f"  no production model for {horizon}/{target}, skipping")
        return

    latest_per_symbol = load_todays_snapshot() if horizon == "next_day" else load_latest_labelled(horizon)
    if latest_per_symbol.empty:
        print(f"  nothing to score for {horizon}/{target}")
        return

    columns = FEATURE_SETS[model_row["feature_set_version"]]
    model = joblib.load(model_row["artifact_path"])
    X = latest_per_symbol[columns]

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

    explainer = build_explainer(model, is_classification)
    shap_values = compute_shap_batch(explainer, X)
    direction = "up" if target == "p_move_up_2pct" else "down" if target == "p_move_down_2pct" else "return"

    now = datetime.now(timezone.utc)
    rows = []
    for i, (_, row) in enumerate(latest_per_symbol.iterrows()):
        explanation = top_features_for_row(row, shap_values[i] if shap_values is not None else None, columns)
        if explanation is not None:
            explanation["direction"] = direction

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
            "explanation": explanation,
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
