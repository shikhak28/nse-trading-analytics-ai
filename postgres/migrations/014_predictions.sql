-- Every prediction is permanent -- never updated or deleted -- and gets
-- joined against prediction_verification (015) at each checkpoint. This is
-- the source of truth every accuracy/calibration/IC metric elsewhere reads
-- from. Partitioned by month on predicted_at, same pattern as
-- historical_prices / depth_snapshots / features.

CREATE SEQUENCE IF NOT EXISTS predictions_id_seq;

CREATE TABLE predictions (
    id BIGINT NOT NULL DEFAULT nextval('predictions_id_seq'),
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    predicted_at TIMESTAMP NOT NULL,
    horizon VARCHAR(16) NOT NULL,              -- 'eod' | 'next_day'
    target_label VARCHAR(64) NOT NULL,
    model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
    predicted_value NUMERIC NOT NULL,          -- point estimate (return or probability)
    predicted_low NUMERIC,                     -- quantile/conformal interval
    predicted_high NUMERIC,
    confidence NUMERIC,                        -- calibrated probability
    explanation JSONB,                         -- top feature contributions + direction
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, predicted_at),
    UNIQUE (exchange, symbol, predicted_at, horizon, target_label, model_version_id),
    CONSTRAINT fk_predictions_exchange_symbol
        FOREIGN KEY (exchange, symbol) REFERENCES companies(exchange, symbol)
        ON DELETE CASCADE
) PARTITION BY RANGE (predicted_at);

ALTER SEQUENCE predictions_id_seq OWNED BY predictions.id;

-- This month, next month, one buffer month -- predictions only start
-- accumulating from whenever this pipeline goes live, no backfill.
DO $$
DECLARE
    start_month DATE := date_trunc('month', now())::date;
    end_month DATE := date_trunc('month', now() + interval '3 months')::date;
    cursor DATE := start_month;
    partition_name TEXT;
BEGIN
    WHILE cursor < end_month LOOP
        partition_name := 'predictions_' || to_char(cursor, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF predictions FOR VALUES FROM (%L) TO (%L)',
            partition_name, cursor, cursor + interval '1 month'
        );
        cursor := cursor + interval '1 month';
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS predictions_default
    PARTITION OF predictions DEFAULT;

CREATE INDEX idx_predictions_symbol_predicted_at
    ON predictions (exchange, symbol, predicted_at DESC);
