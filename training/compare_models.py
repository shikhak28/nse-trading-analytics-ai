"""Read-only comparison of the newest v1 and v2 next_day models, using the
walk-forward results train.py stored. Train both on the same dataset first, so
their folds cover the same dates. v2 has to beat v1 overall and in most folds;
one good period isn't enough.

Usage:
    python compare_models.py
"""

import json

import db

TARGETS = ["next_day_return", "p_move_up_2pct", "p_move_down_2pct"]
MIN_FOLD_WIN_SHARE = 0.6


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
    return (
        f"id {model['id']} ({model['feature_set_version']})   IC {metrics['overall_ic']:+.4f}   "
        f"sharpe {backtest.get('sharpe')}   max drawdown {backtest.get('max_drawdown')}"
    )


def main():
    for target in TARGETS:
        print(f"\n=== {target} ===")
        baseline, candidate = latest_model(target, "v1"), latest_model(target, "v2")
        if baseline is None or candidate is None:
            print("Needs both a v1 and a v2 model.")
            continue

        print("v1:", describe(baseline))
        print("v2:", describe(candidate))

        baseline_folds, candidate_folds = fold_ics(baseline), fold_ics(candidate)
        shared = sorted(set(baseline_folds) & set(candidate_folds))
        if not shared:
            print("No shared folds to compare.")
            continue
        wins = sum(candidate_folds[fold] > baseline_folds[fold] for fold in shared)
        print(f"v2 better in {wins} of {len(shared)} folds")

        better_overall = candidate["metrics"]["overall_ic"] > baseline["metrics"]["overall_ic"]
        if better_overall and wins / len(shared) >= MIN_FOLD_WIN_SHARE:
            print(f"Passes. To promote: UPDATE model_versions SET status='production' WHERE id={candidate['id']};")
        else:
            print("Does not pass: keep v1.")


if __name__ == "__main__":
    main()
