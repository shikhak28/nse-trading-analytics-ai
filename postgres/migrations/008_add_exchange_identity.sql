-- Adds BSE support alongside NSE. Trading symbols aren't globally unique --
-- dually-listed stocks (RELIANCE, INFY, ...) trade under the same
-- tradingsymbol on both NSE and BSE -- so identity moves from `symbol`
-- alone to `(exchange, symbol)` everywhere it's used as a key.

-- Step 1: detach historical_prices from companies first. Its FK
-- (fk_historical_prices_symbol -> companies(symbol)) depends on companies'
-- current PK, which blocks changing that PK below until the FK is gone.
--
-- Renaming the parent does NOT rename its partitions (historical_prices_2023_07
-- etc. keep their names, just re-parented under the renamed table) -- and
-- this migration reuses those exact partition names later. So the legacy
-- table (parent + all its partitions, and the FK along with them) is copied
-- to a flat staging table and fully dropped, freeing up both the FK
-- dependency and the partition names, before anything is recreated.
ALTER TABLE historical_prices RENAME TO historical_prices_legacy;

CREATE TABLE historical_prices_staging AS SELECT * FROM historical_prices_legacy;

-- historical_prices_id_seq is OWNED BY historical_prices_legacy.id (via the
-- original SERIAL / migration 007's explicit ownership) -- dropping the
-- table while that ownership stands would cascade-drop the sequence too.
-- Detach it first so it survives to be re-attached to the new table below.
ALTER SEQUENCE historical_prices_id_seq OWNED BY NONE;

DROP TABLE historical_prices_legacy;

-- Step 2: companies: symbol-only PK -> composite (exchange, symbol) PK.
-- The `exchange` column already exists and is populated 'NSE' for every
-- existing row. Now unblocked since the FK from historical_prices is gone.
ALTER TABLE companies DROP CONSTRAINT companies_pkey;
ALTER TABLE companies ADD PRIMARY KEY (exchange, symbol);

-- Step 3: recreate historical_prices with the exchange column, widened
-- UNIQUE/FK, same monthly partitioning as before.
CREATE TABLE historical_prices (
    id BIGINT NOT NULL DEFAULT nextval('historical_prices_id_seq'),
    exchange VARCHAR(16) NOT NULL DEFAULT 'NSE',
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
    UNIQUE (exchange, symbol, interval, candle_timestamp),
    CONSTRAINT fk_historical_prices_exchange_symbol
        FOREIGN KEY (exchange, symbol) REFERENCES companies(exchange, symbol)
        ON DELETE CASCADE
) PARTITION BY RANGE (candle_timestamp);

ALTER SEQUENCE historical_prices_id_seq OWNED BY historical_prices.id;

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
    id, exchange, symbol, instrument_token, interval, candle_timestamp,
    open, high, low, close, volume, created_at, updated_at
)
SELECT
    id, 'NSE', symbol, instrument_token, interval, candle_timestamp,
    open, high, low, close, volume, created_at, updated_at
FROM historical_prices_staging;

DROP TABLE historical_prices_staging;
