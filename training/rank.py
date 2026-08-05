"""Daily ranking engine -- computes top-20 per category from today's
predictions and writes a persisted record to daily_rankings. Categories are
limited to targets that actually have a production model right now; see
design doc discussion in the Phase 3 plan for why categories like
"breakout"/"accumulation" are deliberately not invented here.

Run after predict.py in the daily loop:
    python predict.py
    python rank.py
"""

from datetime import date as date_cls

import db

TOP_N = 20

# (category, target_label, ascending) -- ascending=True for "most negative
# first" (top_expected_loss, ranked by most negative predicted return).
CATEGORIES = [
    ("top_buy", "p_move_up_2pct", False),
    ("top_sell", "p_move_down_2pct", False),
    ("top_expected_gain", "next_day_return", False),
    ("top_expected_loss", "next_day_return", True),
]


def rank_category(ranking_date, category, target_label, ascending):
    predictions = db.fetch_predictions_for_date(ranking_date, target_label)
    if predictions.empty:
        print(f"  {category}: no predictions for {ranking_date}, skipping")
        return

    predictions = predictions.sort_values("predicted_value", ascending=ascending).head(TOP_N)

    rows = [
        {
            "ranking_date": ranking_date,
            "category": category,
            "rank": i + 1,
            "exchange": row["exchange"],
            "symbol": row["symbol"],
            "prediction_id": int(row["id"]),
            "prediction_predicted_at": row["predicted_at"],
            "score": float(row["predicted_value"]),
        }
        for i, (_, row) in enumerate(predictions.iterrows())
    ]

    db.insert_rankings(rows)
    print(f"  {category}: wrote {len(rows)} ranked row(s)")


def main():
    ranking_date = date_cls.today()
    print(f"Computing rankings for {ranking_date}...")
    for category, target_label, ascending in CATEGORIES:
        rank_category(ranking_date, category, target_label, ascending)


if __name__ == "__main__":
    main()
