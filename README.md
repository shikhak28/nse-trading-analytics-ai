# Stock Platform

A trading analytics platform for NSE stocks, built around Zerodha's Kite Connect API. It backfills years of historical price data into Postgres, streams live ticks and order-book depth, and includes a local LLM agent (via Ollama) that answers trading questions by actually querying the stored data instead of guessing numbers.

Built as a personal project to work with real time-series data, background job queues, and a tool-calling AI agent, rather than a notebook on a static CSV.

This is a single-tenant app built around one Zerodha account, not a multi-user product. Educational/personal use only, not financial advice.

## What it does

- Backfills 3 years of daily and minute candles for NSE stocks from Kite Connect's historical API, resumable if interrupted, rate-limit aware.
- Streams live ticks over Zerodha's websocket, cached in Redis for fast reads.
- Captures 5-level order-book depth every minute during market hours (9:15–15:30 IST, weekdays).
- A dashboard with live quotes, historical charts, top gainers/losers/volume filters, and real Zerodha holdings/positions.
- A chat agent that answers questions by calling real tools against stored data — historical lookups, stock comparisons, RSI/SMA, breakout screens, volume screens — rather than answering from its own guesses.

## Stack

Node/Express backend, BullMQ for background jobs, Postgres with monthly-partitioned time-series tables, Redis for caching and queues, Socket.IO for live updates, React + Vite + Tailwind frontend, Ollama for the local LLM agent.

## Setup (Windows)

1. Install Git, Node.js LTS, Docker Desktop (with the WSL2 backend), and Ollama. Pull a model — `llama3.2:3b` if you're on a lower-RAM machine, `llama3.1` if you have more headroom.
2. Get a Kite Connect developer app from developers.kite.trade. This is the one paid dependency, there's no way around it.
3. Clone the repo, then create a `.env` file in the project root with your Postgres, Redis, and Kite connection details.
4. `docker compose up -d` to start Postgres and Redis.
5. `npm install` in both `backend/` and `frontend/`.
6. `cd backend && npm run migrate` to set up the schema.
7. Run these in separate terminals: `node server.js`, `node historicalWorker.js`, `node depthWorker.js`, and `npm run dev` inside `frontend/`.
8. Open localhost:5173 and log in through the Zerodha connect flow.

The `companies` table starts empty. Trigger an instrument-master refresh once, then run `node scripts/backfillMinuteHistory.js` to start the historical backfill. This takes hours for a few thousand symbols since Kite rate-limits historical requests to 3/second, but it's resumable — safe to stop and restart.

Check status anytime with `node scripts/status.js` and `node scripts/depthStatus.js`.

## Notes

- One Zerodha account powers the whole app — it isn't multi-tenant.
- Zerodha tokens expire roughly once a day with no refresh flow. When live ticks or sync jobs start failing with auth errors, just log back in through the app.
- `historical_prices` is partitioned by month, so extending the backfill window further back means adding older partitions.
