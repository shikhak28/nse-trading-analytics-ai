# AWS EC2 deployment runbook

Single-instance deployment: backend, frontend, Postgres, Redis, and the
Python training pipeline all on one EC2 box, replacing Machine 2's role
entirely. This is a manual runbook, not automation — AWS provisioning
(console/CLI) has to be done by hand, this file just documents the steps and
points at the config files in `deploy/`.

**Cost note, since training is moving here too**: LightGBM + pandas rolling
feature computation across ~2450 symbols is real CPU/RAM work, not
free-tier-micro-sized. A `t3.large` (2 vCPU / 8 GB) run 24/7 costs roughly
$60-70/month on-demand (check current AWS pricing for your region) — cheaper
if you stop the instance outside training/market hours, but that adds
operational complexity (start/stop scheduling, cold-start delays). Go in
knowing this is an ongoing cost, unlike everything built so far.

## 1. Launch the instance

- Ubuntu 22.04 LTS, `t3.large` or bigger.
- Security group: inbound 22 (SSH, restrict to your IP), 80/443 (HTTP/HTTPS, open).
- Attach enough EBS storage for 1 year of candle data + the OS (50 GB is a reasonable starting point; resize later if needed).

## 2. Install dependencies

```bash
sudo apt update && sudo apt install -y nodejs npm python3 python3-venv nginx git docker.io docker-compose-plugin
```
(Use `nvm` or NodeSource's setup script instead of `apt`'s Node if you need a newer version — check `node -v` matches what's used elsewhere in this project.)

## 3. Postgres + Redis via the existing docker-compose.yml

No need to reinvent this — the repo already has `docker-compose.yml` defining both:
```bash
cd stock-platform
sudo docker compose up -d postgres redis
```

## 4. Clone the code, configure `.env`

```bash
git clone <origin-url> stock-platform   # if not already cloned in step 3
cd stock-platform
# create .env with DB_HOST=localhost, DB_PORT=5432, DB_NAME/USER/PASSWORD
# matching docker-compose.yml, plus KITE_API_KEY/SECRET etc.
```
`.env` is git-ignored — create it by hand here, same as every other machine in this project.

## 5. Schema + dependencies

**If this is a fresh start** (no existing candle history to bring over — syncing fresh from Zerodha from here on): running all migrations immediately is safe, there's nothing to lose yet.
```bash
cd backend && npm install && npm run migrate
```

**If migrating existing data from Machine 2**: do NOT run `npm run migrate` yet — it would apply `017_drop_depth_snapshots.sql` immediately, before you have any backup of that data on this new instance. Instead: apply migrations *up to 016 only* for now (temporarily move `017_drop_depth_snapshots.sql` out of `postgres/migrations/` before running `npm run migrate`, put it back after step 9 below), then `pg_dump` Machine 2's database and `pg_restore` it into this instance's Postgres. That dump file (plus Machine 2's still-intact original database) is your safety net — see step 9, which is where 017 and the retention cleanup actually happen, deliberately after this restore, never before it.

```bash
cd backend && npm install
```

Either way:
```bash
cd ../frontend && npm install && npm run build
cd ../training && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

## 6. Background processes (systemd)

Copy each unit file from `deploy/` to `/etc/systemd/system/`, adjusting `User`/`WorkingDirectory` if the repo isn't under `/home/ubuntu`:

```bash
sudo cp deploy/stock-backend.service deploy/stock-historical-worker.service deploy/stock-depth-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stock-backend stock-historical-worker stock-depth-worker
```

- `stock-backend` — the API server (`server.js`).
- `stock-historical-worker` — candle sync scheduler (`historicalWorker.js`), essential for daily EOD data to ever land.
- `stock-depth-worker` — despite the name, only needed now for the **live** quote/depth feed (`depthWorker.js` → `liveTicker.service.js`); depth persistence to Postgres was removed (migration 017).

## 7. nginx (reverse proxy + static frontend)

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/stock-platform
sudo ln -s /etc/nginx/sites-available/stock-platform /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Adjust the `root` path in `deploy/nginx.conf` if the repo isn't under `/home/ubuntu`.

## 8. Training loop (cron, once trusted)

Same manual-first philosophy as before — run the loop by hand a few times on this machine and confirm it works before automating:
```bash
cd training && source venv/bin/activate
python build_dataset.py && python predict.py && python verify.py && python rank.py
```
Once trusted, install `deploy/training-cron.txt`'s line via `crontab -e`.

## 9. Data retention + depth cleanup (destructive — only if migrating existing data)

Skip this entirely if you did the "fresh start" path in step 5 — there's nothing to prune.

If migrating from Machine 2: this is where that dump actually earns its keep as a backup. On Machine 2 (once reachable):
```bash
pg_dump -h <host> -p <port> -U <user> -d <db> -Fc -f stockdb_backup_$(date +%F).dump
```
Copy that file to this instance and restore it into the Postgres container from step 3:
```bash
pg_restore -h localhost -p 5432 -U <user> -d <db> stockdb_backup_*.dump
```
**Only now**, with that dump file (and Machine 2's untouched original) as a rollback, apply the destructive cleanup on this instance:
```bash
cd backend
# if you moved 017_drop_depth_snapshots.sql out of postgres/migrations/ in
# step 5, move it back in now, then:
npm run migrate                                 # applies 017, drops depth_snapshots
node scripts/pruneOldPartitions.js              # dry run first -- review the output
node scripts/pruneOldPartitions.js --confirm    # only after reviewing
```
