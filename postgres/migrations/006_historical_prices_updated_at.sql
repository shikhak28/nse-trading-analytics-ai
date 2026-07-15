-- saveHistoricalPrices() upserts set updated_at on conflict (mirrors the
-- companies table pattern), but this column was never added when the table
-- was created.
ALTER TABLE historical_prices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
