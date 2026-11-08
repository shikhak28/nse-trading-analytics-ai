"""Backfills the `features` table from historical_prices and writes a local
parquet cache (features joined with labels, per horizon) for fast training
iteration without re-hitting Postgres every run.

Usage:
    python build_dataset.py                       # all symbols
    python build_dataset.py --symbols RELIANCE,TCS --exchange NSE
"""

import argparse

import pandas as pd

import db
from config import FEATURE_SET_VERSION, CACHE_DIR
from features import FEATURE_COLUMNS, add_market_features, compute_features
from labels import compute_labels


def build_for_symbol(exchange, symbol):
    candles = db.fetch_daily_candles(exchange, symbol)
    if len(candles) < 30:
        return None, {}, None

    feats = compute_features(candles)
    label_sets = compute_labels(candles)
    # Only v1 columns decide which rows exist, so the v2 candidates (some need
    # 50 days of history) can't change what the production model trains on.
    valid_feats = feats.dropna(subset=FEATURE_COLUMNS)

    feature_rows = []
    for horizon in ["eod", "next_day"]:
        for ts, row in valid_feats.iterrows():
            feature_rows.append({
                "exchange": exchange,
                "symbol": symbol,
                "feature_timestamp": ts,
                "horizon": horizon,
                "feature_set_version": FEATURE_SET_VERSION,
                "features": row[FEATURE_COLUMNS].to_dict(),
            })

    cache_frames = {}
    for horizon in ["eod", "next_day"]:
        labels = label_sets[horizon]
        merged = valid_feats.join(labels, how="inner").dropna(subset=FEATURE_COLUMNS + list(labels.columns))
        if len(merged):
            merged = merged.reset_index()
            merged.insert(0, "symbol", symbol)
            merged.insert(0, "exchange", exchange)
            cache_frames[horizon] = merged

    # The frames above need a known outcome, so they stop a day short of the
    # newest candle. Live scoring needs exactly that newest day.
    latest = None
    if len(valid_feats):
        latest = valid_feats.tail(1).reset_index()
        latest.insert(0, "symbol", symbol)
        latest.insert(0, "exchange", exchange)

    return feature_rows, cache_frames, latest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", type=str, default=None, help="comma-separated symbols; default = all")
    parser.add_argument("--exchange", type=str, default=None)
    args = parser.parse_args()

    if args.symbols:
        symbols = [(args.exchange or "NSE", s.strip()) for s in args.symbols.split(",")]
    else:
        companies = db.fetch_all_symbols(exchange=args.exchange)
        symbols = list(companies.itertuples(index=False, name=None))

    print(f"Building features for {len(symbols)} symbol(s)...")

    all_cache = {"eod": [], "next_day": []}
    all_latest = []
    total_feature_rows = 0

    for i, (exchange, symbol) in enumerate(symbols, 1):
        feature_rows, cache_frames, latest = build_for_symbol(exchange, symbol)
        if latest is not None:
            all_latest.append(latest)
        if feature_rows:
            db.upsert_features(feature_rows)
            total_feature_rows += len(feature_rows)
        for horizon, frame in cache_frames.items():
            all_cache[horizon].append(frame)

        if i % 50 == 0 or i == len(symbols):
            print(f"  {i}/{len(symbols)} symbols processed, {total_feature_rows} feature rows written so far")

    sectors = db.fetch_sectors()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for horizon, frames in all_cache.items():
        if not frames:
            continue
        combined = add_market_features(pd.concat(frames, ignore_index=True), sectors)
        out_path = CACHE_DIR / f"{horizon}.parquet"
        combined.to_parquet(out_path, index=False)
        print(f"Wrote {out_path} ({len(combined)} rows)")

    if all_latest:
        latest_path = CACHE_DIR / "next_day_latest.parquet"
        add_market_features(pd.concat(all_latest, ignore_index=True), sectors).to_parquet(latest_path, index=False)
        print(f"Wrote {latest_path} ({len(all_latest)} symbols)")


if __name__ == "__main__":
    main()
