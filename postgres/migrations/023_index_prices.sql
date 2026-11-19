-- Daily candles for market indices (NIFTY 50, NIFTY BANK, INDIA VIX) from
-- Kite. Kept apart from historical_prices, which is tied to the companies
-- table and partitioned by date. trade_date is the IST trading day.

CREATE TABLE IF NOT EXISTS index_prices (
    symbol TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open NUMERIC,
    high NUMERIC,
    low NUMERIC,
    close NUMERIC NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, trade_date)
);
