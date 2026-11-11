// The one place the Signal rule lives. The Price Groups page shows it and
// the Accuracy page's report card scores it, so both must use this.
//
// Positive / Negative: one direction's chance of a 2% move leads the other
// by at least 15 points, and the expected move beats the ~0.3% round-trip
// trading cost. Both chances close = just a volatile stock, no direction.
const SIGNAL_GAP = 0.15;
const TRADING_COST = 0.003;

// "Liquid" = at least ₹20 crore traded per day on average (last 20
// sessions), and not a trade-to-trade (-BE, -BZ) or SME (-SM, -ST) series.
const LIQUID_MIN_VALUE = 2e8;
const THIN_SERIES = /-(BE|BZ|SM|ST)$/;

function signalFor({ expected_return, chance_up, chance_down }) {
  if (chance_up == null || chance_down == null || expected_return == null) return "none";
  const gap = chance_up - chance_down;
  if (gap >= SIGNAL_GAP && expected_return > TRADING_COST) return "positive";
  if (gap <= -SIGNAL_GAP && expected_return < -TRADING_COST) return "negative";
  return "none";
}

function isLiquid({ symbol, avg_traded_value }) {
  return !THIN_SERIES.test(symbol) && (avg_traded_value ?? 0) >= LIQUID_MIN_VALUE;
}

// SQL condition that drops predictions made on a known-bad day (see
// postgres/migrations/021_invalid_prediction_days.sql). Expects alias p.
const VALID_DAY_SQL =
  "NOT EXISTS (SELECT 1 FROM invalid_prediction_days ipd WHERE ipd.day = p.predicted_at::date)";

module.exports = { signalFor, isLiquid, TRADING_COST, SIGNAL_GAP, LIQUID_MIN_VALUE, VALID_DAY_SQL };
