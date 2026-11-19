"""Read-only comparison of the newest baseline and candidate next_day models
(default v1 vs v2; e.g. --baseline v3 --candidate v4), using the
walk-forward results train.py stored. Train both on the same dataset first, so
their folds cover the same dates. v2 has to beat v1 overall and in most folds;
one good period isn't enough.

Usage:
    python compare_models.py
    python compare_models.py --baseline v3 --candidate v4
"""

import argparse
import json

import db

TARGETS = ["next_day_return", "p_move_up_2pct", "p_move_down_2pct", "p_move_up_4pct"]
MIN_FOLD_WIN_SHARE = 0.6
MIN_IC_IMPROVEMENT = 0.005  # a smaller lead is noise at this sample size


def latest_model(target, feature_set):
    df = db.fetch_df(
        """
        SELECT id, version_tag, feature_set_version, metrics
        FROM model_versions
        WHERE horizon = 'next_day' AND target_label = %s AND feature_set_version = %s
          AND status IN ('production', 'shadow')
        ORDER BY trained_at DESC LIMIT 1
        """,
        (target, feature_set),
    )
    if df.empty:
        return None
    model = df.iloc[0].to_dict()
    if isinstance(model["metrics"], str):
        model["metrics"] = json.loads(model["metrics"])
    return model


def fold_ics(model):
    return {f["fold"]: f["ic"] for f in model["metrics"]["fold_metrics"] if f["ic"] is not None}


def describe(model):
    metrics = model["metrics"]
    backtest = metrics.get("backtest", {})
    liquid = (metrics.get("by_liquidity") or {}).get("Rs 20 crore+/day") or {}
    liquid_ic = liquid.get("mean_daily_ic", liquid.get("ic"))
    return (
        f"id {model['id']} ({model['feature_set_version']})   IC {metrics['overall_ic']:+.4f}   "
        f"liquid IC {liquid_ic}   sharpe {backtest.get('sharpe')}   max drawdown {backtest.get('max_drawdown')}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", default="v1")
    parser.add_argument("--candidate", default="v2")
    args = parser.parse_args()
    b, c = args.baseline, args.candidate

    for target in TARGETS:
        print(f"\n=== {target} ===")
        baseline, candidate = latest_model(target, b), latest_model(target, c)
        if baseline is None or candidate is None:
            print(f"Needs both a {b} and a {c} model.")
            continue

        print(f"{b}:", describe(baseline))
        print(f"{c}:", describe(candidate))

        baseline_folds, candidate_folds = fold_ics(baseline), fold_ics(candidate)
        shared = sorted(set(baseline_folds) & set(candidate_folds))
        if not shared:
            print("No shared folds to compare.")
            continue
        wins = sum(candidate_folds[fold] > baseline_folds[fold] for fold in shared)
        print(f"{c} better in {wins} of {len(shared)} folds")

        better_overall = candidate["metrics"]["overall_ic"] - baseline["metrics"]["overall_ic"] >= MIN_IC_IMPROVEMENT
        if better_overall and wins / len(shared) >= MIN_FOLD_WIN_SHARE:
            print(f"Passes. To promote: UPDATE model_versions SET status='production' WHERE id={candidate['id']};")
        else:
            print(f"Does not pass: keep {b}.")


if __name__ == "__main__":
    main()
