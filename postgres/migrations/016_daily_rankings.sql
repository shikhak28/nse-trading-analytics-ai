-- Persisted daily top-N per category (design doc's Ranking Engine, scoped to
-- what we actually have models for: the 3 next_day targets currently in
-- production). Low volume (a handful of categories x top-20 x daily), so
-- unlike features/predictions this is a plain table, not partitioned.
--
-- predictions' primary key is the composite (id, predicted_at) because it's
-- partitioned by predicted_at -- so the FK here must reference both columns,
-- same pattern as prediction_verification (015).

CREATE TABLE daily_rankings (
    id SERIAL PRIMARY KEY,
    ranking_date DATE NOT NULL,
    category VARCHAR(32) NOT NULL,   -- 'top_buy' | 'top_sell' | 'top_expected_gain' | 'top_expected_loss'
    rank INTEGER NOT NULL,
    exchange VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    prediction_id BIGINT NOT NULL,
    prediction_predicted_at TIMESTAMP NOT NULL,
    score NUMERIC NOT NULL,
    UNIQUE (ranking_date, category, rank),
    CONSTRAINT fk_daily_rankings_prediction
        FOREIGN KEY (prediction_id, prediction_predicted_at)
        REFERENCES predictions(id, predicted_at)
        ON DELETE CASCADE
);

CREATE INDEX idx_daily_rankings_date_category
    ON daily_rankings (ranking_date, category);
