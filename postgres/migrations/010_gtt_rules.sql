-- Saved, reusable GTT rule templates -- the user defines a named rule once
-- (e.g. "3% dip buy") and re-applies it at GTT-creation time instead of
-- re-entering percentages every time. Purely a local template: creating a
-- rule here never touches Kite, only placing a GTT built from one does.

CREATE TABLE IF NOT EXISTS gtt_rules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rule_type VARCHAR(16) NOT NULL DEFAULT 'single', -- 'single' | 'oco'
    transaction_type VARCHAR(8) NOT NULL,            -- BUY | SELL
    direction VARCHAR(16),                           -- 'below' | 'above' (single only)
    percent_offset NUMERIC,                          -- single only
    target_percent NUMERIC,                          -- oco only (favorable leg)
    stoploss_percent NUMERIC,                         -- oco only (adverse leg)
    order_type VARCHAR(16) NOT NULL DEFAULT 'LIMIT',
    product VARCHAR(16) NOT NULL DEFAULT 'CNC',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gtt_rules_user ON gtt_rules(user_id);
