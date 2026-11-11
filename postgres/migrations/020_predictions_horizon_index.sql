-- Date-wide reads (Price Group page, Predictions page with no symbol) filter
-- on horizon + a predicted_at range. The only index so far leads with
-- exchange/symbol, so those reads scanned the whole partition.
CREATE INDEX IF NOT EXISTS idx_predictions_horizon_predicted_at
    ON predictions (horizon, predicted_at DESC);
