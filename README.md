# Stock Platform — NSE Market Data Pipeline + AI Trading Agent

A full-stack trading analytics platform I built to apply data engineering and applied-AI skills to a real, messy, real-time data problem: ingesting, storing, and reasoning over years of Indian stock market (NSE) data — end to end, from a rate-limited broker API down to a locally-hosted LLM agent that can actually answer questions about the data.

Built solo as a personal/portfolio project (data science background) to go beyond notebooks-on-a-CSV and build something with real pipelines, a real time-series database, and a real (if small) production-shaped architecture: background workers, job queues, partitioned tables, and a tool-calling AI agent that queries live data instead of hallucinating numbers.

> ⚠️ **Educational / personal project.** Not financial advice, not a production trading system. Single-tenant by design — built around one Zerodha account, not a multi-user SaaS.

---

## 🤖 Highlight: The AI Trading Agent

The centerpiece of this project. A **tool-calling LLM agent** (running on **local Ollama** — no OpenAI/Anthropic API key, no cost) that answers trading questions by actually querying the platform's own stored data, instead of guessing.

**Why this matters (the applied-AI part):** LLMs are bad at math and worse at knowing today's stock price. So the agent doesn't answer from its own "knowledge" — it's given a set of tools and a system prompt that *forbids* it from guessing numbers. Every question about a real stock triggers a real database query first.

**How it works:**
1. User asks a question in the chat UI (e.g. *"Is RELIANCE oversold right now?"* or *"Compare TCS and INFY over the last 6 months"*).
2. The agent (`backend/agent/orchestrator.js`) sends the message + a list of available tools to Ollama.
3. Ollama decides which tool(s) to call and with what arguments (OpenAI-style function-calling).
4. The backend executes the real tool against Postgres, returns the actual numbers to the model.
5. The model loops (up to 5 tool iterations) until it can give a grounded, concrete answer — citing the real figures the tools returned.
6. Every conversation turn and every screening result is persisted (`agent_conversations`, `agent_analysis_results` tables) — nothing is ephemeral.

**Tools the agent has access to** (`backend/agent/tools/`):

| Tool | What it does |
|---|---|
| `get_historical_data` | Pulls stored daily/minute candles for a symbol over a date range |
| `compare_stocks` | Compares price performance of 2+ stocks over the same period |
| `calculate_indicator` | Computes RSI or SMA for a stock from stored candles |
| `screen_by_rsi` | Screens the entire tracked universe for RSI conditions (overbought/oversold) |
| `find_breakouts` | Flags stocks breaking out of an N-day high/low window |
| `scan_increasing_volume` | Scans for stocks with a rising volume trend over a window |

This is the part of the project I'd point to first: it demonstrates tool-calling agent design, prompt engineering for groundedness (anti-hallucination), and wiring an LLM to a real analytical backend — not just a chatbot wrapper.

---

## 📊 The Data Pipeline (the data engineering part)

Everything the agent (and the dashboard) relies on is backed by a real ingestion pipeline, not a static dataset:

- **3-year historical backfill** — day + minute candles for every NSE company tracked, pulled from Zerodha's Kite Connect historical-data API.
- **Resumable, incremental sync** — each symbol/interval resumes from its last stored candle rather than re-fetching everything; safe to stop and restart mid-backfill.
- **Rate-limit-aware job queue** (BullMQ + Redis) — Kite's historical API is rate-limited, so syncing 2,000+ symbols is throttled (concurrency + limiter) and chunked (365-day chunks for daily candles, 60-day chunks for minute candles) rather than hammered.
- **Live tick ingestion** — a persistent Zerodha WebSocket subscription across every tracked company, cached in Redis for low-latency reads.
- **Market depth capture** — order-book depth (5 levels, bid/ask) snapshotted every minute, **strictly during NSE market hours (9:15–15:30 IST, weekdays)** — the job self-gates on IST wall-clock time rather than fighting cron syntax for an exact window.
- **Partitioned time-series storage** — `historical_prices` is partitioned by month in Postgres; with ~113 GB and tens of millions of rows, unbounded queries would scan every partition, so hot-path queries are deliberately time-bounded to keep this fast.
- **Two independent background workers** — historical sync and depth capture run as separate processes (`historicalWorker.js`, `depthWorker.js`) so a crash or restart in one never interrupts the other.

---

## 🖥️ Frontend

React + Vite dashboard:
- **Dashboard** — live-updating company list with real-time quotes (Socket.IO relay of the backend's Redis-cached ticks).
- **Historical/Market page** — candlestick/line charts (Recharts) over stored historical data, with timeframe selection and a market-depth panel.
- **AI Agent page** — the chat interface for the tool-calling agent described above.
- **Auth/Profile** — Zerodha Kite Connect login flow, trading account details.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js, Express |
| Background jobs | BullMQ (Redis-backed job queues) |
| Database | PostgreSQL 15 (monthly-partitioned time-series tables) |
| Cache / pub-sub | Redis |
| Real-time push | Socket.IO |
| Broker integration | Zerodha Kite Connect (REST + WebSocket) |
| AI / LLM | Ollama (local, e.g. `llama3.1` / `llama3.2:3b`) — tool-calling, no cloud API cost |
| Frontend | React 19, Vite, Tailwind CSS, Recharts |
| Infra | Docker Compose (Postgres + Redis) |

---

## Skills This Project Demonstrates

- **Data engineering**: ETL/backfill pipeline design, incremental/resumable sync, rate-limit-aware API integration, partitioned time-series schema design, query performance tuning on large tables.
- **Systems design**: decoupled background workers, job queues, fault isolation (one process crashing shouldn't take down another), Redis as both cache and message broker.
- **Applied AI / LLMs**: tool-calling agent architecture, prompt design for factual grounding, integrating an LLM with a real analytical backend rather than a static knowledge base, running models locally (cost-free, private).
- **Full-stack development**: REST API design, WebSocket real-time updates, React dashboard with charting.
- **Financial/quant basics**: technical indicators (RSI, SMA), breakout/volume screening logic, working with OHLCV candle data and order-book depth.

---

## Architecture at a Glance

```
                     ┌─────────────────────┐
                     │   Zerodha Kite API   │
                     │ (REST + WebSocket)   │
                     └──────────┬───────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
┌───────────────┐      ┌────────────────┐        ┌───────────────┐
│historicalWorker│      │  depthWorker   │        │   server.js   │
│ (BullMQ jobs:  │      │ (live ticker + │        │  (Express API)│
│ backfill, EOD  │      │ depth capture, │        │  + AI Agent   │
│ sync, instrument│     │ market-hours   │        │  orchestrator │
│ master refresh)│      │  gated)        │        │               │
└───────┬────────┘      └───────┬────────┘        └───────┬───────┘
        │                       │                         │
        ▼                       ▼                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                          PostgreSQL                              │
│   companies · historical_prices (partitioned) · depth_snapshots  │
│   agent_conversations · agent_analysis_results · users           │
└─────────────────────────────────────────────────────────────────┘
        ▲
        │
┌───────┴────────┐        ┌──────────────┐        ┌───────────────┐
│     Redis      │◄──────►│  BullMQ jobs │        │  Ollama (LLM) │
│ (live-tick     │        │  (queues)    │        │  tool-calling │
│  cache + queues)│       └──────────────┘        └───────────────┘
└────────────────┘
        ▲
        │
┌───────┴────────┐
│  React Frontend │ ── Dashboard · Historical Charts · AI Agent Chat
└────────────────┘
```

---

## 🪟 Full Setup Guide (Windows)

This walks through setting the whole thing up on a fresh Windows machine — every install, every command, every extension.

### Step 1 — Install prerequisites

1. **Git for Windows** — [git-scm.com/download/win](https://git-scm.com/download/win). Use default install options (this also gives you Git Bash, which you can use instead of PowerShell for any `bash`-style commands if you prefer).

2. **Node.js LTS (v20+)** — [nodejs.org](https://nodejs.org/). Download the **LTS** Windows installer, run it, keep defaults (this also installs `npm`). Verify in PowerShell:
   ```powershell
   node -v
   npm -v
   ```

3. **Docker Desktop** — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/). During install, enable the **WSL2 backend** when prompted (Docker will prompt you to install WSL2 if it isn't already; follow its instructions — it may ask you to run `wsl --install` in an admin PowerShell and restart). After install, **launch Docker Desktop once** and make sure it says "Docker Desktop is running" before continuing.

4. **VS Code** — [code.visualstudio.com](https://code.visualstudio.com/). Then install these extensions (Extensions panel, `Ctrl+Shift+X`, search each by name and click Install):
   - **ESLint** (`dbaeumer.vscode-eslint`) — lint feedback for the JS/React code
   - **Prettier - Code formatter** (`esbenp.prettier-vscode`)
   - **Docker** (`ms-azuretools.vscode-docker`) — manage the Postgres/Redis containers from the sidebar
   - **PostgreSQL** (`ms-ossdata.vscode-pgsql` or `cweijan.vscode-postgresql-client2`) — browse tables/run queries without leaving VS Code
   - **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) — autocomplete for the frontend's Tailwind classes
   - **GitLens** (`eamodio.gitlens`) — optional but handy for commit history/blame

5. **Ollama for Windows** — [ollama.com/download/windows](https://ollama.com/download/windows). Run the installer. It installs as a background service, so you generally don't need to manually start it (check the system tray for the llama icon).

   Then, in PowerShell, pull a tool-calling-capable model. **Check your free RAM first**:
   ```powershell
   ollama pull llama3.1        # ~4.9GB — needs a healthy amount of free RAM
   # or, on a lower-RAM machine:
   ollama pull llama3.2:3b      # ~2GB — lighter, still supports tool-calling
   ```

6. **A Zerodha Kite Connect app** (required — this is the one external, paid prerequisite). Sign up for a Kite Connect developer app at [developers.kite.trade](https://developers.kite.trade/) using a Zerodha demat account. You'll get an **API key** and **API secret**. This project is built around a single Zerodha account (not multi-user), and Kite Connect apps are a paid subscription on Zerodha's side — there's no free substitute for this part.

### Step 2 — Clone the repo

```powershell
git clone <your-repo-url>
cd stock-platform
```

### Step 3 — Set up environment variables

Create a file named `.env` in the project root (`stock-platform\.env`) with:

```
PORT=5000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=stockdb
DB_USER=admin
DB_PASSWORD=admin

REDIS_URL=redis://localhost:6379

KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_ACCESS_TOKEN=
KITE_REDIRECT_URL=http://localhost:5000/auth/callback
FRONTEND_URL=http://localhost:5173

OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
```

Replace `your_kite_api_key` / `your_kite_api_secret` with the values from your Kite Connect app. Leave `KITE_ACCESS_TOKEN` blank — you'll get that by logging in through the app itself once it's running (Zerodha access tokens expire roughly daily and have no refresh-token flow, so you'll re-login through the UI whenever it expires).

### Step 4 — Start Postgres + Redis

In PowerShell, from the project root:

```powershell
docker compose up -d
```

This starts Postgres 15 and Redis 7 in containers (`stock-postgres`, `stock-redis`). Check they're up:

```powershell
docker ps
```

You should see both containers with status `Up`.

### Step 5 — Install dependencies

```powershell
cd backend
npm install
cd ..\frontend
npm install
cd ..
```

### Step 6 — Run database migrations

```powershell
cd backend
npm run migrate
```

This applies every SQL file in `postgres/migrations/` in order. It's idempotent (tracks what's already applied), so it's always safe to re-run.

### Step 7 — Start everything (five terminals)

Open **Windows Terminal** (recommended — lets you have multiple tabs) or five separate PowerShell windows. Docker is already running from Step 4, so you need:

**Terminal 1 — API server**
```powershell
cd backend
node server.js
```

**Terminal 2 — Historical worker** (historical backfill, daily EOD sync, instrument-master-refresh)
```powershell
cd backend
node historicalWorker.js
```

**Terminal 3 — Depth worker** (live ticker + market-hours-only depth capture)
```powershell
cd backend
node depthWorker.js
```

**Terminal 4 — Frontend**
```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser, and log in through the Zerodha connect flow (this is what fills in `KITE_ACCESS_TOKEN` behind the scenes).

### Step 8 — First-time data population (one-off)

The `companies` table starts empty. To populate it and kick off the historical backfill:

1. Trigger an instrument-master refresh (pulls the NSE company list from Kite) — either wait for the scheduled Sunday 3 AM job, or trigger it manually once (see `backend/jobs/instrumentMasterRefresh.job.js`).
2. Run the backfill script:
   ```powershell
   cd backend
   node scripts/backfillMinuteHistory.js
   ```
   This enqueues a sync job for every tracked company and can take **hours** for a few thousand symbols (Kite's historical-data API is rate-limited to 3 requests/sec). It's resumable — safe to stop (Ctrl+C) and restart later; nothing is lost, jobs persist in Redis.

### Checking status anytime

```powershell
cd backend
node scripts/status.js       # queue counts, companies per exchange, historical row counts, DB size
node scripts/depthStatus.js  # depth-snapshot freshness and coverage
```

### Common Windows gotchas

- **"docker compose" not recognized** — make sure Docker Desktop is actually running (check system tray) before running the command; also confirm you're using `docker compose` (space, no hyphen) which ships with modern Docker Desktop, not the old standalone `docker-compose`.
- **Port already in use (5432, 6379, 5000, 5173)** — something else on your machine is using that port. Either stop it, or change the port in `.env` / `docker-compose.yml` / `vite.config.js` accordingly.
- **WSL2 not installed** — if Docker Desktop complains about WSL2, open an **administrator** PowerShell and run `wsl --install`, restart your machine, then relaunch Docker Desktop.
- **Ollama model download slow/fails** — model pulls are multi-GB; make sure you have a stable connection and enough disk space (`ollama pull` resumes if interrupted — just re-run it).

---

## Project Structure

```
stock-platform/
├── backend/
│   ├── server.js                 # Express API entrypoint
│   ├── historicalWorker.js       # Historical sync + EOD sync + instrument refresh worker
│   ├── depthWorker.js            # Live ticker + market-depth capture worker
│   ├── agent/                    # AI trading agent (orchestrator, tools, indicators)
│   ├── jobs/                     # BullMQ job processors
│   ├── services/                 # Business logic (market data, sync, auth, depth, live ticker)
│   ├── routes/                   # Express route handlers
│   ├── config/                   # DB/Redis/Kite client config
│   └── scripts/                  # One-off/status scripts (backfill, migrate, status checks)
├── frontend/
│   └── src/
│       ├── pages/                # Dashboard, Market/History, Agent chat, Profile, Login
│       ├── components/           # Reusable UI (charts, tables, depth panel, sidebar)
│       └── context/               # Auth + theme context
├── postgres/
│   └── migrations/               # Ordered, idempotent SQL migrations
└── docker-compose.yml            # Postgres + Redis
```

---

## Notes

- **Single-tenant by design** — one Zerodha login powers the whole app; see `backend/services/auth.service.js`.
- **No auto-refresh on Zerodha tokens** — when live ticks or historical sync start failing with auth errors, reconnect through the app's login flow.
- **`historical_prices` is partitioned by month** — extending the backfill window means adding new partitions (see `postgres/migrations/007_partition_historical_prices.sql` for the pattern).
