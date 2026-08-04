-- Verification results for each prediction, one row per (prediction,
-- checkpoint). Not partitioned -- volume here is bounded by prediction count
-- x checkpoints per prediction (2 for the eod/next_day horizons in scope:
-- 'eod' and 'next_day'), nowhere near predictions/features/historical_prices
-- scale.
--
-- predictions' primary key is the composite (id, predicted_at) because it's
-- partitioned by predicted_at -- so the FK here must reference both columns,
-- which is why prediction_predicted_at is carried alongside prediction_id
-- rather than just the id.

CREATE TABLE prediction_verification (
    id SERIAL PRIMARY KEY,
    prediction_id BIGINT NOT NULL,
    prediction_predicted_at TIMESTAMP NOT NULL,
    checkpoint VARCHAR(16) NOT NULL,           -- 'eod' | 'next_day'
    checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actual_value NUMERIC,
    error NUMERIC,
    signal_hit BOOLEAN,
    realized_return NUMERIC,
    UNIQUE (prediction_id, checkpoint),
    CONSTRAINT fk_prediction_verification_prediction
        FOREIGN KEY (prediction_id, prediction_predicted_at)
        REFERENCES predictions(id, predicted_at)
        ON DELETE CASCADE
);
