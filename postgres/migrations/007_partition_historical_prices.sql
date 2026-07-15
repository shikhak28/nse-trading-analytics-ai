-- Partition historical_prices by month ahead of storing minute-level candles
-- for ~2000 companies (~560M rows over a 3yr backfill). Postgres can't
-- ALTER an existing populated table to add PARTITION BY, so this rebuilds
-- the table: rename old -> _legacy, create the new partitioned table with
-- the same shape, copy the data across, then drop the legacy table.
--
-- A partitioned table's PRIMARY KEY/UNIQUE constraints must include the
-- partition key column, so `id` moves from a solo PRIMARY KEY to a
-- composite (id, candle_timestamp) one; `id` keeps using the original
-- sequence so existing values aren't renumbered.

ALTER TABLE historical_prices RENAME TO historical_prices_legacy;

CREATE TABLE historical_prices (
    id BIGINT NOT NULL DEFAULT nextval('historical_prices_id_seq'),
    symbol VARCHAR(32) NOT NULL,
    instrument_token VARCHAR(64) NOT NULL,
    interval VARCHAR(32) NOT NULL,
    candle_timestamp TIMESTAMP NOT NULL,
    open NUMERIC,
    high NUMERIC,
    low NUMERIC,
    close NUMERIC,
    volume NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, candle_timestamp),
    UNIQUE (symbol, interval, candle_timestamp),
    CONSTRAINT fk_historical_prices_symbol
        FOREIGN KEY (symbol) REFERENCES companies(symbol)
        ON DELETE CASCADE
) PARTITION BY RANGE (candle_timestamp);

ALTER SEQUENCE historical_prices_id_seq OWNED BY historical_prices.id;

-- Monthly partitions from 3 years back through 1 year forward, plus a
-- catch-all default partition for anything outside that window so inserts
-- never fail even if this range needs extending later.
DO $$
DECLARE
    start_month DATE := date_trunc('month', now() - interval '3 years')::date;
    end_month DATE := date_trunc('month', now() + interval '1 year')::date;
    cursor DATE := start_month;
    partition_name TEXT;
BEGIN
    WHILE cursor < end_month LOOP
        partition_name := 'historical_prices_' || to_char(cursor, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF historical_prices FOR VALUES FROM (%L) TO (%L)',
            partition_name, cursor, cursor + interval '1 month'
        );
        cursor := cursor + interval '1 month';
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS historical_prices_default
    PARTITION OF historical_prices DEFAULT;

INSERT INTO historical_prices (
    id, symbol, instrument_token, interval, candle_timestamp,
    open, high, low, close, volume, created_at, updated_at
)
SELECT
    id, symbol, instrument_token, interval, candle_timestamp,
    open, high, low, close, volume, created_at, updated_at
FROM historical_prices_legacy;

DROP TABLE historical_prices_legacy;
