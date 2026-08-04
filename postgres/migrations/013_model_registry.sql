-- Model registry: every training run is immutable and versioned, never
-- overwritten in place -- promotion/rollback just flips model_versions.status.
-- Low row count (one row per training run, not per prediction), so no
-- partitioning needed here.

CREATE TABLE model_versions (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(64) NOT NULL,
    horizon VARCHAR(16) NOT NULL,             -- 'eod' | 'next_day'
    target_label VARCHAR(64) NOT NULL,        -- e.g. 'next_day_return', 'p_move_up_2pct'
    algorithm VARCHAR(32) NOT NULL,           -- 'lightgbm', ...
    version_tag VARCHAR(64) NOT NULL,
    artifact_path TEXT NOT NULL,
    feature_set_version VARCHAR(32) NOT NULL,
    trained_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    train_window_start DATE NOT NULL,
    train_window_end DATE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'shadow'
        CHECK (status IN ('shadow', 'production', 'retired', 'rolled_back')),
    metrics JSONB,                            -- {ic, sharpe, precision_at_10, ...}
    UNIQUE (horizon, target_label, version_tag)
);

CREATE INDEX idx_model_versions_production
    ON model_versions (horizon, target_label, status);

CREATE TABLE training_runs (
    id SERIAL PRIMARY KEY,
    model_version_id INTEGER REFERENCES model_versions(id) ON DELETE CASCADE,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    hyperparameters JSONB,
    train_rows INTEGER,
    val_rows INTEGER,
    val_metrics JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed'))
);
