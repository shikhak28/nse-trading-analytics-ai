-- Upcoming corporate events (board meetings for results, dividends, ...),
-- loaded from the NSE Event Calendar CSV that the owner uploads weekly.
-- NSE has no free official API and its terms forbid scraping, so the file is
-- downloaded by hand and parsed by backend/services/events.service.js.

CREATE TABLE IF NOT EXISTS corporate_events (
    id BIGSERIAL PRIMARY KEY,
    exchange TEXT NOT NULL DEFAULT 'NSE',
    symbol TEXT NOT NULL,
    company_name TEXT,
    purpose TEXT NOT NULL,
    details TEXT,
    event_date DATE NOT NULL,
    is_results BOOLEAN NOT NULL DEFAULT false,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exchange, symbol, event_date, purpose)
);

CREATE INDEX IF NOT EXISTS corporate_events_date_idx ON corporate_events (event_date);
CREATE INDEX IF NOT EXISTS corporate_events_symbol_idx ON corporate_events (exchange, symbol, event_date);
