-- Hides instruments that aren't real, tradable stocks (see
-- backend/jobs/stockQualityCheck.job.js). A flag rather than a DELETE because
-- deleting a company cascades to its candles and predictions, and a hidden
-- stock must be able to come back if it trades again.
--
-- excluded_reason NULL means visible. force_include is a manual override for
-- a stock the check got wrong.

ALTER TABLE companies
    ADD COLUMN excluded_reason VARCHAR(32),
    ADD COLUMN excluded_at TIMESTAMP,
    ADD COLUMN force_include BOOLEAN NOT NULL DEFAULT false;
