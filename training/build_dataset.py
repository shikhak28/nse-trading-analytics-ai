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
from features import compute_features
from labels import compute_labels


def build_for_symbol(exchange, symbol):
    candles = db.fetch_daily_candles(exchange, symbol)
    if len(candles) < 30:
        return None, {}

    feats = compute_features(candles)
    label_sets = compute_labels(candles)
    valid_feats = feats.dropna()

    feature_rows = []
    for horizon in ["eod", "next_day"]:
        for ts, row in valid_feats.iterrows():
            feature_rows.append({
                "exchange": exchange,
                "symbol": symbol,
                "feature_timestamp": ts,
                "horizon": horizon,
                "feature_set_version": FEATURE_SET_VERSION,
                "features": row.to_dict(),
            })

    cache_frames = {}
    for horizon in ["eod", "next_day"]:
        merged = valid_feats.join(label_sets[horizon], how="inner").dropna()
        if len(merged):
            merged = merged.reset_index()
            merged.insert(0, "symbol", symbol)
            merged.insert(0, "exchange", exchange)
            cache_frames[horizon] = merged

    return feature_rows, cache_frames


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
    total_feature_rows = 0

    for i, (exchange, symbol) in enumerate(symbols, 1):
        feature_rows, cache_frames = build_for_symbol(exchange, symbol)
        if feature_rows:
            db.upsert_features(feature_rows)
            total_feature_rows += len(feature_rows)
        for horizon, frame in cache_frames.items():
            all_cache[horizon].append(frame)

        if i % 50 == 0 or i == len(symbols):
            print(f"  {i}/{len(symbols)} symbols processed, {total_feature_rows} feature rows written so far")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for horizon, frames in all_cache.items():
        if not frames:
            continue
        combined = pd.concat(frames, ignore_index=True)
        out_path = CACHE_DIR / f"{horizon}.parquet"
        combined.to_parquet(out_path, index=False)
        print(f"Wrote {out_path} ({len(combined)} rows)")


if __name__ == "__main__":
    main()
