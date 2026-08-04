# Training pipeline

Candle-only (no depth/order-book data — `depth_snapshots` history is too
short to be useful yet). Runs on the training machine (Windows, Memurai
instead of Redis, otherwise the same Node stack as the main machine — same
`server.js`/`historicalWorker.js`/`depthWorker.js`, `npm run migrate` works
identically there), which has its **own** Postgres and independently syncs
candles straight from Zerodha via its own sync process — it does NOT get
candle data copied over from this machine. Code reaches the training
machine via `git pull` from the same `origin` this repo already pushes to.
The only thing that ever needs to move between the two machines' databases
is **predictions flowing back**, so this machine's API can serve them.

## One-time setup on the training machine

```powershell
git pull
cd training
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```


```powershell
cd ..\backend
npm run migrate
```

These 4 new tables (`features`, `model_versions`, `training_runs`,
`predictions`, `prediction_verification`) 


## The pipeline

1. **On the training machine**, once its own Zerodha sync has candles in
   `historical_prices`, run the pipeline in order:
   ```bash
   python build_dataset.py                                   # backfill features table + local parquet cache
   python train.py --horizon next_day --target next_day_return
   python train.py --horizon next_day --target p_move_up_2pct
   python train.py --horizon next_day --target p_move_down_2pct
   python train.py --horizon eod --target eod_return
   ```
   Each run prints walk-forward IC, calibration/Brier (classification
   targets), and a naive top-decile backtest (Sharpe/drawdown/profit
   factor). Model selection is these metrics, not accuracy — see design doc
   §3. Every run registers a `model_versions` row with `status='shadow'`.

2. **Promote manually** after reviewing the metrics:
   ```sql
   UPDATE model_versions SET status = 'production' WHERE id = <id>;
   ```

3. **Generate + verify predictions** (repeat daily once trusted):
   ```bash
   python predict.py
   python verify.py
   ```

4. **Export predictions back** to this machine so the API can serve them
   (this is the only data that ever flows training-machine → this machine).
   On the training machine, using whichever `pg_dump` matches its Postgres
   version (on Windows, typically under
   `C:\Program Files\PostgreSQL\<version>\bin\pg_dump.exe`):
   ```powershell
   pg_dump -h <host> -p <port> -U <user> -d <db> `
     -t model_versions -t training_runs -t predictions -t prediction_verification `
     -Fc -f predictions_2026-07-28.dump
   ```
   Copy it back here, then:
   ```bash
   cd backend && node scripts/importPredictions.js /path/to/predictions_....dump
   ```

Nothing here is automated yet (no cron, no scheduler) — this loop should be
run by hand a few times and the baseline metrics honestly evaluated before
any of it gets wired into a recurring job. See the design doc's Phase 5 for
what "automated" eventually looks like.

## File overview

- `config.py` — env/config, feature-set version, horizon/target definitions.
- `db.py` — Postgres access (psycopg2), read/write helpers for every table
  this pipeline touches.
- `features.py` — `compute_features(df)`, the single leakage-safe candle
  feature function every stage calls.
- `labels.py` — `compute_labels(df)`, label definitions for `eod` and
  `next_day` horizons, correctly attributed to the feature snapshot date
  each label can legitimately be predicted from.
- `build_dataset.py` — backfills `features` table + writes
  `cache/{horizon}.parquet` (features joined with labels, for fast
  iteration without re-hitting Postgres).
- `evaluate.py` — IC, Brier score, calibration table, naive top-decile
  backtest (Sharpe/drawdown/profit factor).
- `train.py` — walk-forward LightGBM training + model registration.
- `predict.py` — scores the latest snapshot per symbol with the current
  production model, writes `predictions`.
- `verify.py` — resolves predictions against realized prices, writes
  `prediction_verification`.
