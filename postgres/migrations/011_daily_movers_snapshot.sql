-- Persisted daily leaderboard (top gainers/losers/volume/bid/sell) so past
-- days can be browsed later -- movers.service.js's existing /market/movers
-- is Redis-backed and only ever reflects "right now", resetting whenever the
-- live ticker restarts. This table is filled once per day by
-- dailyMoversSnapshot.job.js, after historical_prices' EOD day-candle sync
-- has landed for that date.

CREATE TABLE IF NOT EXISTS daily_movers_snapshot (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    metric VARCHAR(16) NOT NULL,
    rank INTEGER NOT NULL,
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    company_name TEXT,
    close NUMERIC,
    prev_close NUMERIC,
    change_percent NUMERIC,
    volume BIGINT,
    total_buy_quantity BIGINT,
    total_sell_quantity BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (snapshot_date, metric, rank)
);

CREATE INDEX IF NOT EXISTS idx_daily_movers_snapshot_date_metric
    ON daily_movers_snapshot(snapshot_date, metric);
