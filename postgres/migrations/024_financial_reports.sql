-- Financial results read from uploaded results PDFs by Gemini (see
-- backend/services/financialReports.service.js). One row per upload; the
-- headline numbers are kept as columns so they can later become model
-- features, the full reading as JSON.
CREATE TABLE financial_reports (
    id SERIAL PRIMARY KEY,
    exchange VARCHAR(16) NOT NULL DEFAULT 'NSE',
    symbol VARCHAR(32) NOT NULL,
    period_label VARCHAR(128),          -- as written in the report, e.g. "Quarter ended 30 Sep 2026"
    period_end DATE,
    consolidated BOOLEAN,
    unit VARCHAR(32),                   -- e.g. "₹ crore", "₹ lakh"
    revenue NUMERIC,
    revenue_prev_year NUMERIC,
    net_profit NUMERIC,
    net_profit_prev_year NUMERIC,
    eps NUMERIC,
    eps_prev_year NUMERIC,
    verdict VARCHAR(16),                -- strong | mixed | weak
    reading JSONB NOT NULL,             -- everything Gemini returned
    file_name VARCHAR(255),
    file_sha256 CHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_reports_symbol ON financial_reports (exchange, symbol, period_end DESC);
CREATE UNIQUE INDEX idx_financial_reports_file ON financial_reports (symbol, file_sha256);
