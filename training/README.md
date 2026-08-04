# Training pipeline

Candle-only (no depth/order-book data — `depth_snapshots` history is too
short to be useful yet). Runs on the training machine (Windows, Memurai
instead of Redis, otherwise the same Node stack as the coding machine — same
`server.js`/`historicalWorker.js`/`depthWorker.js`, `npm run migrate` works
identically there). That machine is also **the one actually used as the
live dashboard** — it has its own Postgres, its own independent Zerodha
candle sync, and its own running API/frontend. Code reaches it via
`git pull` from the same `origin` this repo already pushes to.

Because everything (training, predictions, DB, API, frontend) lives on that
one machine, **nothing needs to be copied between machines at all** — once
`predict.py`/`verify.py` write to that machine's Postgres, its own
`server.js` (same code, same DB connection) can serve `/predictions`,
`/verification`, etc. immediately. The other (coding) machine is dev-only;
whatever it runs locally is just for testing, not the real thing.

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
`predictions`, `prediction_verification`) don't exist yet on that machine's
Postgres, so this is a required one-time step.

## The pipeline

Run in order, on the training/dashboard machine:

```powershell
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

**Promote manually** after reviewing the metrics:
```sql
UPDATE model_versions SET status = 'production' WHERE id = <id>;
```

**Generate + verify predictions** (repeat daily once trusted):
```powershell
python predict.py
python verify.py
```

That's it — `predict.py`/`verify.py` write straight into this machine's own
Postgres, and its own already-running `server.js` reads from that same DB,
so `GET /predictions`, `/verification`, `/accuracy`, `/model` are live
immediately. No export/copy step, since training and serving are the same
machine here.

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
