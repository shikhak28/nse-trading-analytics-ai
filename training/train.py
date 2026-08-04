"""Walk-forward LightGBM training for one (horizon, target_label) pair.

Usage:
    python train.py --horizon next_day --target next_day_return
    python train.py --horizon next_day --target p_move_up_2pct
    python train.py --horizon eod --target eod_return

Expanding-window walk-forward (design doc §7): train on [t0, fold_end),
validate on the following FOLD_MONTHS-month block, embargo one day at the
boundary (the label horizon here is at most 1 day), then slide forward.
Fits on all folds' validation predictions pooled together for the reported
metrics -- a truer walk-forward estimate than a single train/val split.

Model selection is NOT accuracy/RMSE -- it's walk-forward IC + a naive
top-decile backtest (design doc §3). Promotion to production stays a manual
step: inspect the printed metrics, then flip model_versions.status by hand.
"""

import argparse
from datetime import datetime

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression

import db
from config import ARTIFACTS_DIR, CACHE_DIR, FEATURE_SET_VERSION
from evaluate import brier_score, information_coefficient, top_decile_backtest
from features import FEATURE_COLUMNS

CLASSIFICATION_TARGETS = {"p_move_up_2pct", "p_move_down_2pct"}
# top_decile_backtest always simulates going LONG the top-decile-by-score
# names. For an up-move-probability target that's the right side to be on;
# for a down-move-probability target the top decile is exactly who you'd
# want to short/avoid, not buy -- so the realized returns fed into the
# backtest get sign-flipped for these targets, turning "top decile" into
# "best short candidates" and making the reported Sharpe/drawdown/profit
# factor describe a short strategy instead of an inverted-looking long one.
SHORT_SIDE_TARGETS = {"p_move_down_2pct"}
FOLD_MONTHS = 3
MIN_TRAIN_MONTHS = 12


def load_dataset(horizon):
    path = CACHE_DIR / f"{horizon}.parquet"
    if not path.exists():
        raise SystemExit(f"{path} not found -- run build_dataset.py first.")
    df = pd.read_parquet(path)
    df["candle_timestamp"] = pd.to_datetime(df["candle_timestamp"])
    return df.sort_values("candle_timestamp").reset_index(drop=True)


def walk_forward_folds(dates):
    start = dates.min()
    train_end = start + pd.DateOffset(months=MIN_TRAIN_MONTHS)
    overall_end = dates.max()

    folds = []
    while train_end < overall_end:
        val_end = min(train_end + pd.DateOffset(months=FOLD_MONTHS), overall_end)
        embargo_start = train_end - pd.DateOffset(days=1)
        folds.append((start, embargo_start, train_end, val_end))
        train_end = val_end
    return folds


def fit_regressor(X_train, y_train):
    model = lgb.LGBMRegressor(
        objective="quantile", alpha=0.5, n_estimators=200, learning_rate=0.05,
        max_depth=5, min_child_samples=30, verbose=-1,
    )
    model.fit(X_train, y_train)
    return model


def fit_classifier(X_train, y_train):
    base = lgb.LGBMClassifier(
        n_estimators=200, learning_rate=0.05, max_depth=5, min_child_samples=30, verbose=-1,
    )
    model = CalibratedClassifierCV(base, method="isotonic", cv=3)
    model.fit(X_train, y_train)
    return model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", required=True, choices=["eod", "next_day"])
    parser.add_argument("--target", required=True)
    args = parser.parse_args()

    df = load_dataset(args.horizon)
    if args.target not in df.columns:
        raise SystemExit(f"target '{args.target}' not in dataset columns: {list(df.columns)}")

    is_classification = args.target in CLASSIFICATION_TARGETS
    folds = walk_forward_folds(df["candle_timestamp"])
    if not folds:
        raise SystemExit("Not enough history for even one walk-forward fold -- need more backfilled data.")

    print(f"Running {len(folds)} walk-forward fold(s) for horizon={args.horizon} target={args.target}")

    return_col = "next_day_return" if "next_day_return" in df.columns else "eod_return"
    all_val_true, all_val_pred, all_val_dates, all_val_symbols, all_val_returns = [], [], [], [], []
    fold_metrics = []
    started_at = datetime.utcnow()

    for i, (start, embargo_start, train_end, val_end) in enumerate(folds, 1):
        train_mask = df["candle_timestamp"] < embargo_start
        val_mask = (df["candle_timestamp"] >= train_end) & (df["candle_timestamp"] < val_end)

        train_df, val_df = df[train_mask], df[val_mask]
        if len(train_df) < 200 or len(val_df) < 20:
            continue

        X_train, y_train = train_df[FEATURE_COLUMNS], train_df[args.target]
        X_val, y_val = val_df[FEATURE_COLUMNS], val_df[args.target]

        if is_classification:
            model = fit_classifier(X_train, y_train)
            pred = model.predict_proba(X_val)[:, 1]
        else:
            model = fit_regressor(X_train, y_train)
            pred = model.predict(X_val)

        ic = information_coefficient(y_val.values, pred)
        fold_metrics.append({"fold": i, "val_rows": len(val_df), "ic": ic})
        print(f"  fold {i}: train={len(train_df)} val={len(val_df)} IC={ic:.4f}" if pd.notna(ic) else f"  fold {i}: IC=nan")

        all_val_true.extend(y_val.values)
        all_val_pred.extend(pred)
        all_val_dates.extend(val_df["candle_timestamp"].values)
        all_val_symbols.extend(val_df["symbol"].values)
        all_val_returns.extend(val_df[return_col].values)

    if not all_val_pred:
        raise SystemExit("No fold produced enough validation data -- need a longer backfilled history.")

    overall_ic = information_coefficient(all_val_true, all_val_pred)
    metrics = {"overall_ic": overall_ic, "n_folds": len(fold_metrics), "fold_metrics": fold_metrics}

    if is_classification:
        metrics["brier_score"] = brier_score(all_val_true, all_val_pred)

    is_short_side = args.target in SHORT_SIDE_TARGETS
    backtest_returns = [-r for r in all_val_returns] if is_short_side else all_val_returns
    backtest = top_decile_backtest(all_val_dates, all_val_symbols, backtest_returns, all_val_pred)
    backtest["side"] = "short" if is_short_side else "long"
    metrics["backtest"] = backtest

    print(f"\nOverall walk-forward IC: {overall_ic:.4f}" if pd.notna(overall_ic) else "\nOverall walk-forward IC: nan")
    print(f"Top-decile backtest ({backtest['side']}): {backtest}")

    # Final model: fit on everything up to the last embargo boundary so the
    # artifact reflects the most recent data, same recipe as the folds above.
    final_train = df[df["candle_timestamp"] < folds[-1][1]]
    X_final, y_final = final_train[FEATURE_COLUMNS], final_train[args.target]
    final_model = fit_classifier(X_final, y_final) if is_classification else fit_regressor(X_final, y_final)

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    version_tag = f"{args.horizon}_{args.target}_{started_at.strftime('%Y%m%d%H%M%S')}"
    artifact_path = ARTIFACTS_DIR / f"{version_tag}.joblib"
    import joblib
    joblib.dump(final_model, artifact_path)

    model_version_id = db.insert_model_version({
        "model_name": f"lgbm_{args.horizon}_{args.target}",
        "horizon": args.horizon,
        "target_label": args.target,
        "algorithm": "lightgbm",
        "version_tag": version_tag,
        "artifact_path": str(artifact_path),
        "feature_set_version": FEATURE_SET_VERSION,
        "train_window_start": pd.Timestamp(folds[0][0]).date(),
        "train_window_end": pd.Timestamp(folds[-1][1]).date(),
        "status": "shadow",
        "metrics": metrics,
    })

    db.insert_training_run({
        "model_version_id": model_version_id,
        "started_at": started_at,
        "finished_at": datetime.utcnow(),
        "hyperparameters": {"objective": "quantile" if not is_classification else "binary_calibrated"},
        "train_rows": len(final_train),
        "val_rows": len(all_val_pred),
        "val_metrics": metrics,
        "status": "completed",
    })

    print(f"\nSaved artifact: {artifact_path}")
    print(f"Registered model_versions.id={model_version_id}, status='shadow'.")
    print("Review the metrics above, then manually promote with:")
    print(f"  UPDATE model_versions SET status='production' WHERE id={model_version_id};")


if __name__ == "__main__":
    main()
