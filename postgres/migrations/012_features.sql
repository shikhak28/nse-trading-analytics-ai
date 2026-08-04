-- Feature store for the prediction pipeline. Candle-derived only for now
-- (no depth/order-book features -- depth_snapshots history is too short to
-- be useful yet, see project design doc). One row per (symbol, timestamp,
-- horizon, feature_set_version); JSONB rather than fixed columns because the
-- feature set is expected to iterate constantly during early research --
-- unlike depth_snapshots, a migration per experiment would be too slow here.
--
-- Partitioned by month on feature_timestamp, same pattern as
-- historical_prices (007) / depth_snapshots (009).

CREATE SEQUENCE IF NOT EXISTS features_id_seq;

CREATE TABLE features (
    id BIGINT NOT NULL DEFAULT nextval('features_id_seq'),
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    feature_timestamp TIMESTAMP NOT NULL,
    horizon VARCHAR(16) NOT NULL,              -- 'eod' | 'next_day'
    feature_set_version VARCHAR(32) NOT NULL,
    features JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, feature_timestamp),
    UNIQUE (exchange, symbol, feature_timestamp, horizon, feature_set_version),
    CONSTRAINT fk_features_exchange_symbol
        FOREIGN KEY (exchange, symbol) REFERENCES companies(exchange, symbol)
        ON DELETE CASCADE
) PARTITION BY RANGE (feature_timestamp);

ALTER SEQUENCE features_id_seq OWNED BY features.id;

-- 3 years back through 1 year forward, matching historical_prices' window
-- since features are computed over the same candle history.
DO $$
DECLARE
    start_month DATE := date_trunc('month', now() - interval '3 years')::date;
    end_month DATE := date_trunc('month', now() + interval '1 year')::date;
    cursor DATE := start_month;
    partition_name TEXT;
BEGIN
    WHILE cursor < end_month LOOP
        partition_name := 'features_' || to_char(cursor, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF features FOR VALUES FROM (%L) TO (%L)',
            partition_name, cursor, cursor + interval '1 month'
        );
        cursor := cursor + interval '1 month';
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS features_default
    PARTITION OF features DEFAULT;

CREATE INDEX idx_features_symbol_timestamp
    ON features (exchange, symbol, feature_timestamp DESC);
