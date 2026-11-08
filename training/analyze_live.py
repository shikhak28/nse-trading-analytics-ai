"""Read-only report on how the next_day models have done on real, live
predictions. Nothing is written to the database.

Outcomes are recomputed here from candles instead of read from
prediction_verification, for two reasons:
  - predict.py scores each symbol's newest snapshot and stamps it with today's
    date, even when no new candle has arrived. Predictions made during a sync
    outage are therefore old data under a new date, and need to be separated.
  - signal_hit for the probability models means "predicted >= 50% matched the
    outcome". Those models almost never reach 50%, so it mostly counts days a
    stock didn't move 2%.

Usage (from training/):
    python analyze_live.py            last 90 days
    python analyze_live.py --days 30
"""

import argparse
import warnings
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import db
from evaluate import brier_score, calibration_table, information_coefficient, top_decile_backtest

# Same bands as frontend/src/utils/priceBands.js.
PRICE_GROUPS = [
    ("Penny", 0, 500),
    ("Mid", 500, 5000),
    ("Upper", 5000, 10000),
    ("High Risk", 10000, np.inf),
]

MOVE_THRESHOLD = 0.02
TOP_N_PER_DAY = 20
GROUP_TOP_N_PER_DAY = 5
ROUND_TRIP_COST = 0.003  # assumption: NSE delivery STT + charges + slippage
MAX_PLAUSIBLE_MOVE = 0.5  # beyond this it's a split/bonus, not a return
MAX_NEXT_CANDLE_GAP_DAYS = 5
MIN_DAYS_TO_TRUST = 20


def load_predictions(since):
    df = db.fetch_df(
        """
        SELECT p.exchange, p.symbol, p.predicted_at, p.target_label,
               p.predicted_value::float8 AS predicted
        FROM predictions p
        JOIN companies c ON c.exchange = p.exchange AND c.symbol = p.symbol
                        AND c.excluded_reason IS NULL
        WHERE p.horizon = 'next_day' AND p.predicted_at >= %s
        """,
        (since,),
    )
    df["predicted_at"] = pd.to_datetime(df["predicted_at"])
    df["day"] = df["predicted_at"].dt.normalize()
    # A rerun of predict.py on the same day supersedes the earlier one.
    return df.sort_values("predicted_at").drop_duplicates(
        ["day", "exchange", "symbol", "target_label"], keep="last"
    )


def load_candles(since):
    # Daily candles are stored at either 00:00 or 18:30 of the previous day,
    # depending on the timezone of the process that synced them. Adding 6
    # hours lands both on the real trading date.
    df = db.fetch_df(
        """
        SELECT exchange, symbol, (candle_timestamp + INTERVAL '6 hours')::date AS day,
               close::float8 AS close, created_at
        FROM historical_prices
        WHERE interval = 'day' AND candle_timestamp >= %s
        """,
        (since - timedelta(days=15),),
    )
    df["day"] = pd.to_datetime(df["day"])
    df["created_at"] = pd.to_datetime(df["created_at"])
    df = df.sort_values("created_at").drop_duplicates(["exchange", "symbol", "day"], keep="first")
    df = df.sort_values(["exchange", "symbol", "day"])

    grouped = df.groupby(["exchange", "symbol"])
    df["next_close"] = grouped["close"].shift(-1)
    df["next_day"] = grouped["day"].shift(-1)
    too_far = (df["next_day"] - df["day"]).dt.days > MAX_NEXT_CANDLE_GAP_DAYS
    df.loc[too_far, "next_close"] = np.nan
    df["realized"] = df["next_close"] / df["close"] - 1
    return df


def attach_outcomes(predictions, candles):
    df = predictions.merge(
        candles[["exchange", "symbol", "day", "close", "created_at", "realized"]],
        on=["exchange", "symbol", "day"],
        how="left",
    )
    # Fresh = that day's candle already existed when the prediction was made.
    df["fresh"] = df["created_at"].notna() & (df["created_at"] <= df["predicted_at"])
    return df


def resolved_only(df):
    return df[df["realized"].notna() & (df["realized"].abs() <= MAX_PLAUSIBLE_MOVE)].copy()


def price_group(close):
    for name, low, high in PRICE_GROUPS:
        if low <= close < high:
            return name
    return None


def daily_ics(df):
    ics = {}
    for day, group in df.groupby("day"):
        if len(group) >= 10:
            ics[day] = information_coefficient(group["realized"], group["predicted"])
    return pd.Series(ics, dtype=float).dropna()


def describe_ic(ics):
    if ics.empty:
        return "not enough data"
    t_stat = ics.mean() / ics.std() * np.sqrt(len(ics)) if len(ics) > 1 and ics.std() > 0 else float("nan")
    return f"mean IC {ics.mean():+.4f}   t-stat {t_stat:+.2f}   positive days {(ics > 0).mean():.0%}   days {len(ics)}"


def pct(value):
    return "n/a" if value is None or pd.isna(value) else f"{value * 100:+.2f}%"


def heading(text):
    print(f"\n=== {text} ===")


def report_data_health(raw, since):
    heading("1. DATA HEALTH")
    stamps = db.fetch_df(
        """
        SELECT to_char(candle_timestamp, 'HH24:MI') AS stored_time, count(*) AS candles
        FROM historical_prices
        WHERE interval = 'day' AND candle_timestamp >= %s
        GROUP BY 1 ORDER BY 2 DESC LIMIT 4
        """,
        (since,),
    )
    print("Daily candle stored times:", ", ".join(f"{r.stored_time} x{r.candles}" for r in stamps.itertuples()))

    returns = raw[raw["target_label"] == "next_day_return"]
    days = returns.groupby("day").agg(
        stocks=("symbol", "size"),
        fresh=("fresh", "mean"),
        resolved=("realized", lambda s: s.notna().sum()),
    )
    print(f"Prediction days: {len(days)}   ({days.index.min().date()} to {days.index.max().date()})")
    print(f"Days with under 50% fresh data: {(days['fresh'] < 0.5).sum()}")
    print("\nday         stocks  fresh  resolved")
    for day, row in days.iterrows():
        print(f"{day.date()}  {int(row['stocks']):>6}  {row['fresh']:>5.0%}  {int(row['resolved']):>8}")


def report_verification_match(returns):
    heading("2. DOES THE SITE'S VERIFICATION MATCH THE CANDLES?")
    stored = db.fetch_df(
        """
        SELECT p.exchange, p.symbol, p.predicted_at, v.realized_return::float8 AS stored_return
        FROM prediction_verification v
        JOIN predictions p ON p.id = v.prediction_id AND p.predicted_at = v.prediction_predicted_at
        WHERE p.horizon = 'next_day' AND p.target_label = 'next_day_return'
        """
    )
    if stored.empty:
        print("No verified next_day_return rows yet.")
        return
    stored["predicted_at"] = pd.to_datetime(stored["predicted_at"])
    merged = returns.merge(stored, on=["exchange", "symbol", "predicted_at"], how="inner")
    merged = merged[merged["realized"].notna()]
    if merged.empty:
        print("No overlap between verified rows and recomputed outcomes.")
        return
    matched = ((merged["realized"] - merged["stored_return"]).abs() < 0.001).mean()
    print(f"Compared {len(merged)} rows. Stored return matches recomputed return: {matched:.1%}")


def report_models():
    heading("3. PRODUCTION MODELS")
    models = db.fetch_df(
        """
        SELECT target_label, version_tag, trained_at, train_window_end, metrics
        FROM model_versions
        WHERE horizon = 'next_day' AND status = 'production'
        ORDER BY target_label
        """
    )
    for row in models.itertuples():
        print(f"{row.target_label}: {row.version_tag}, trained {str(row.trained_at)[:10]}, data to {row.train_window_end}")
        print(f"   backtest metrics: {str(row.metrics)[:400]}")


def report_return_model(fresh, stale):
    heading("4. EXPECTED % MOVE MODEL (fresh predictions only)")
    if fresh.empty:
        print("No resolved fresh predictions.")
        return

    print("Ranking skill: ", describe_ic(daily_ics(fresh)))
    print("Stale data:    ", describe_ic(daily_ics(stale)))

    went_up = fresh["realized"] > 0
    print(f"\nRows: {len(fresh)}")
    print(f"Direction correct: {((fresh['predicted'] > 0) == went_up).mean():.1%}   "
          f"(always guessing the commoner direction: {max(went_up.mean(), 1 - went_up.mean()):.1%})")
    print(f"Average size: predicted {fresh['predicted'].abs().mean() * 100:.2f}%   actual {fresh['realized'].abs().mean() * 100:.2f}%")

    ranked = fresh.copy()
    ranked["rank"] = ranked.groupby("day")["predicted"].rank(pct=True)
    market = ranked.groupby("day")["realized"].mean()
    top = ranked[ranked["rank"] >= 0.9].groupby("day")["realized"].mean()
    bottom = ranked[ranked["rank"] <= 0.1].groupby("day")["realized"].mean()

    print("\nAverage next-day return per day:")
    print(f"  Top 10% by model:    {pct(top.mean())}")
    print(f"  All stocks (market): {pct(market.mean())}")
    print(f"  Bottom 10% by model: {pct(bottom.mean())}")
    print(f"  Top 10% minus market: {pct((top - market).mean())}   beat market on {((top - market) > 0).mean():.0%} of days")
    print(f"  Top 10% after {ROUND_TRIP_COST:.2%} assumed cost: {pct(top.mean() - ROUND_TRIP_COST)}")

    backtest = top_decile_backtest(fresh["day"], fresh["symbol"], fresh["realized"], fresh["predicted"])
    print(f"  Top 10% backtest before costs: {backtest}")

    print("\nBy market direction:")
    labels = fresh["day"].map(lambda day: "up days" if market[day] >= 0 else "down days")
    for label, group in fresh.groupby(labels):
        print(f"  {label:<10}{describe_ic(daily_ics(group))}")


def report_probability_model(df, target, is_hit):
    print(f"\n--- {target} ---")
    if df.empty:
        print("No resolved fresh predictions.")
        return

    df = df.copy()
    df["actual"] = is_hit(df["realized"]).astype(float)
    base_rate = df["actual"].mean()
    site_hit = ((df["predicted"] >= 0.5) == df["actual"].astype(bool)).mean()

    top = df.sort_values("predicted", ascending=False).groupby("day").head(TOP_N_PER_DAY)
    precision = top["actual"].mean()

    print(f"Rows {len(df)}   stocks that actually moved 2% (base rate) {base_rate:.1%}")
    print(f"Site-style hit rate {site_hit:.1%}   rows predicted at 50% or more {(df['predicted'] >= 0.5).mean():.2%}")
    print(f"Top {TOP_N_PER_DAY} per day were right {precision:.1%}   lift over base rate {precision / base_rate:.2f}x")
    if df["actual"].nunique() == 2:
        print(f"AUC {roc_auc_score(df['actual'], df['predicted']):.3f}")
    print(f"Brier {brier_score(df['actual'], df['predicted']):.5f}   no-skill Brier {brier_score(df['actual'], [base_rate] * len(df)):.5f}")

    print("Calibration:")
    table = calibration_table(df["actual"].values, df["predicted"].values, n_bins=5)
    for row in table.itertuples():
        print(f"  predicted {row.predicted_mean:>6.1%}   actual {row.actual_rate:>6.1%}   n={row.n}")


def report_price_groups(fresh):
    heading("6. BY PRICE GROUP (expected % move, fresh only)")
    if fresh.empty:
        print("No resolved fresh predictions.")
        return

    df = fresh.copy()
    df["group"] = df["close"].map(price_group)
    df["vs_market"] = df["realized"] - df.groupby("day")["realized"].transform("mean")

    print("Return vs market = how the stocks did compared with that day's average stock.")
    for name, _, _ in PRICE_GROUPS:
        group = df[df["group"] == name]
        print(f"\n{name}")
        if group.empty:
            print("  no data")
            continue

        days = group["day"].nunique()
        stocks = group.groupby("day").size().mean()
        warning = "   LOW SAMPLE" if days < MIN_DAYS_TO_TRUST or len(group) < MIN_DAYS_TO_TRUST else ""
        rise = group.sort_values("predicted", ascending=False).groupby("day").head(GROUP_TOP_N_PER_DAY)
        fall = group.sort_values("predicted").groupby("day").head(GROUP_TOP_N_PER_DAY)

        print(f"  rows {len(group)}   days {days}   stocks/day {stocks:.0f}{warning}")
        print(f"  Rank correlation vs market: {information_coefficient(group['vs_market'], group['predicted']):+.4f}")
        print(f"  Direction correct: {((group['predicted'] > 0) == (group['realized'] > 0)).mean():.1%}")
        print(f"  Top {GROUP_TOP_N_PER_DAY} 'Expected to Rise': predicted {pct(rise['predicted'].mean())}   "
              f"actual {pct(rise['realized'].mean())}   vs market {pct(rise['vs_market'].mean())}")
        print(f"  Top {GROUP_TOP_N_PER_DAY} 'Expected to Fall': predicted {pct(fall['predicted'].mean())}   "
              f"actual {pct(fall['realized'].mean())}   vs market {pct(fall['vs_market'].mean())}")


def main():
    warnings.filterwarnings("ignore", category=UserWarning)
    warnings.filterwarnings("ignore", message=".*constant.*")

    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()
    since = datetime.now() - timedelta(days=args.days)

    predictions = load_predictions(since)
    if predictions.empty:
        print(f"No next_day predictions in the last {args.days} days.")
        return

    raw = attach_outcomes(predictions, load_candles(since))
    report_data_health(raw, since)

    returns = raw[raw["target_label"] == "next_day_return"]
    report_verification_match(returns)
    report_models()

    resolved = resolved_only(raw)
    dropped = raw["realized"].notna().sum() - len(resolved)
    print(f"\nRows dropped as split/bonus-sized moves: {dropped}")

    fresh = resolved[resolved["fresh"]]
    stale = resolved[~resolved["fresh"]]
    fresh_returns = fresh[fresh["target_label"] == "next_day_return"]
    stale_returns = stale[stale["target_label"] == "next_day_return"]

    report_return_model(fresh_returns, stale_returns)

    heading("5. 2% MOVE PROBABILITY MODELS (fresh predictions only)")
    report_probability_model(fresh[fresh["target_label"] == "p_move_up_2pct"], "p_move_up_2pct", lambda r: r >= MOVE_THRESHOLD)
    report_probability_model(fresh[fresh["target_label"] == "p_move_down_2pct"], "p_move_down_2pct", lambda r: r <= -MOVE_THRESHOLD)

    report_price_groups(fresh_returns)


if __name__ == "__main__":
    main()
