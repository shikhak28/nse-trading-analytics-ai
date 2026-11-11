const db = require("../config/db");

async function getPredictions({ symbol, exchange, horizon, date, sector, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const values = [];

  if (symbol) {
    values.push(symbol);
    conditions.push(`p.symbol = $${values.length}`);
  }
  if (exchange) {
    values.push(exchange);
    conditions.push(`p.exchange = $${values.length}`);
  }
  if (horizon) {
    values.push(horizon);
    conditions.push(`p.horizon = $${values.length}`);
  }
  if (date) {
    // A range, not predicted_at::date = $n -- casting the column hides it
    // from partition pruning and the index, so every partition got scanned.
    values.push(date);
    conditions.push(
      `p.predicted_at >= $${values.length}::date AND p.predicted_at < $${values.length}::date + 1`
    );
  }
  if (sector) {
    values.push(sector);
    conditions.push(`c.sector = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(Number(limit));
  values.push(Number(offset));

  const result = await db.query(
    `SELECT p.id, p.exchange, p.symbol, p.predicted_at, p.horizon, p.target_label, p.model_version_id,
            p.predicted_value, p.predicted_low, p.predicted_high, p.confidence, p.explanation,
            c.company_name, c.sector, lc.last_close
     FROM predictions p
     JOIN companies c ON c.exchange = p.exchange AND c.symbol = p.symbol AND c.excluded_reason IS NULL
     -- Close as of when the prediction was made, so an old date is grouped by
     -- its price back then. The 15-day floor limits the scan to the one or two
     -- monthly partitions involved and treats a long-halted stock as unpriced.
     LEFT JOIN LATERAL (
       SELECT hp.close AS last_close
       FROM historical_prices hp
       WHERE hp.exchange = p.exchange AND hp.symbol = p.symbol AND hp.interval = 'day'
         AND hp.candle_timestamp <= p.predicted_at
         AND hp.candle_timestamp >= p.predicted_at - interval '15 days'
       ORDER BY hp.candle_timestamp DESC
       LIMIT 1
     ) lc ON true
     ${where}
     ORDER BY p.predicted_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
}

/**
 * One row per stock for the Price Group page: the three next_day targets
 * pivoted into columns, and the close looked up once per stock (not once per
 * target row). Skips the explanation JSON, which that page never shows. If
 * the models ran twice that day, the latest value of each target wins.
 */
async function getPriceGroupStocks({ date }) {
  const result = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (p.exchange, p.symbol, p.target_label)
              p.exchange, p.symbol, p.target_label, p.predicted_value, p.predicted_at
       FROM predictions p
       WHERE p.horizon = 'next_day'
         AND p.predicted_at >= $1::date AND p.predicted_at < $1::date + 1
       ORDER BY p.exchange, p.symbol, p.target_label, p.predicted_at DESC
     ),
     stocks AS (
       SELECT exchange, symbol, max(predicted_at) AS predicted_at,
              max(predicted_value) FILTER (WHERE target_label = 'next_day_return') AS expected_return,
              max(predicted_value) FILTER (WHERE target_label = 'p_move_up_2pct') AS chance_up,
              max(predicted_value) FILTER (WHERE target_label = 'p_move_down_2pct') AS chance_down
       FROM latest
       GROUP BY exchange, symbol
     )
     SELECT s.exchange, s.symbol, c.company_name, s.predicted_at,
            s.expected_return::float8 AS expected_return,
            s.chance_up::float8 AS chance_up,
            s.chance_down::float8 AS chance_down,
            lc.last_close::float8 AS last_close,
            -- Day candles are stored at 00:00 IST in UTC (18:30 the day
            -- before); +6h lands on the IST trading date, as dailyMovers does.
            to_char(lc.last_close_at + interval '6 hours', 'YYYY-MM-DD') AS last_close_day
     FROM stocks s
     JOIN companies c ON c.exchange = s.exchange AND c.symbol = s.symbol AND c.excluded_reason IS NULL
     -- Same rule as getPredictions: the close as of when the prediction was
     -- made, with a 15-day floor so a long-halted stock reads as unpriced.
     LEFT JOIN LATERAL (
       SELECT hp.close AS last_close, hp.candle_timestamp AS last_close_at
       FROM historical_prices hp
       WHERE hp.exchange = s.exchange AND hp.symbol = s.symbol AND hp.interval = 'day'
         AND hp.candle_timestamp <= s.predicted_at
         AND hp.candle_timestamp >= s.predicted_at - interval '15 days'
       ORDER BY hp.candle_timestamp DESC
       LIMIT 1
     ) lc ON true
     WHERE s.expected_return IS NOT NULL`,
    [date]
  );
  return result.rows;
}

async function getSectors() {
  const result = await db.query(
    `SELECT DISTINCT sector FROM companies WHERE sector IS NOT NULL ORDER BY sector`
  );
  return result.rows.map((row) => row.sector);
}

async function getPredictionById(id) {
  const result = await db.query(
    `SELECT id, exchange, symbol, predicted_at, horizon, target_label, model_version_id,
            predicted_value, predicted_low, predicted_high, confidence, explanation
     FROM predictions WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function getVerification({ symbol, exchange, checkpoint, from, to, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const values = [];

  if (symbol) {
    // Partial, case-insensitive match -- this is a search box, not an
    // exact-symbol lookup, so "reliance" or "rel" should find "RELIANCE".
    values.push(`%${symbol}%`);
    conditions.push(`p.symbol ILIKE $${values.length}`);
  }
  if (exchange) {
    values.push(exchange);
    conditions.push(`p.exchange = $${values.length}`);
  }
  if (checkpoint) {
    values.push(checkpoint);
    conditions.push(`v.checkpoint = $${values.length}`);
  }
  if (from) {
    values.push(from);
    conditions.push(`v.checked_at >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`v.checked_at <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(Number(limit));
  values.push(Number(offset));

  const result = await db.query(
    `SELECT v.id, v.prediction_id, v.checkpoint, v.checked_at, v.actual_value, v.error,
            v.signal_hit, v.realized_return,
            p.exchange, p.symbol, p.predicted_at, p.target_label, p.predicted_value, p.confidence
     FROM prediction_verification v
     JOIN predictions p ON p.id = v.prediction_id AND p.predicted_at = v.prediction_predicted_at
     ${where}
     ORDER BY v.checked_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
}

async function getAccuracy({ groupBy = "day", horizon, targetLabel } = {}) {
  const allowedGroupBy = { day: "checked_at::date", month: "date_trunc('month', checked_at)" };
  const grouping = allowedGroupBy[groupBy] || allowedGroupBy.day;

  // The probability models almost never reach 50%, so their signal_hit mostly
  // counts stocks that simply didn't move 2%. They're scored by calibration
  // in getClassificationMetrics instead.
  const conditions = ["p.target_label NOT IN ('p_move_up_2pct', 'p_move_down_2pct')"];
  const values = [];

  if (horizon) {
    values.push(horizon);
    conditions.push(`p.horizon = $${values.length}`);
  }
  if (targetLabel) {
    values.push(targetLabel);
    conditions.push(`p.target_label = $${values.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const result = await db.query(
    `SELECT ${grouping} AS bucket,
            count(*) AS n,
            avg(CASE WHEN v.signal_hit THEN 1.0 ELSE 0.0 END) AS hit_rate,
            avg(v.error) AS mean_error,
            avg(v.realized_return) AS mean_realized_return
     FROM prediction_verification v
     JOIN predictions p ON p.id = v.prediction_id AND p.predicted_at = v.prediction_predicted_at
     ${where}
     GROUP BY bucket
     ORDER BY bucket DESC`,
    values
  );
  return result.rows;
}

// How the expected-move model has done inside each price group, against that
// day's average stock. Only counts predictions whose day candle already
// existed when they were made, so a sync outage can't blur the result.
// Band edges mirror frontend/src/utils/priceBands.js.
const GROUP_TOP_N = 5;

async function getPriceGroupPerformance({ from }) {
  const result = await db.query(
    `WITH verified AS (
       SELECT DISTINCT ON (p.exchange, p.symbol, p.predicted_at::date)
              p.predicted_at::date AS day,
              p.predicted_value::float8 AS predicted,
              v.realized_return::float8 AS realized,
              lc.close::float8 AS close
       FROM prediction_verification v
       JOIN predictions p ON p.id = v.prediction_id AND p.predicted_at = v.prediction_predicted_at
       JOIN companies c ON c.exchange = p.exchange AND c.symbol = p.symbol AND c.excluded_reason IS NULL
       JOIN LATERAL (
         SELECT hp.close
         FROM historical_prices hp
         WHERE hp.exchange = p.exchange AND hp.symbol = p.symbol AND hp.interval = 'day'
           AND hp.candle_timestamp >= p.predicted_at - interval '2 days'
           AND hp.candle_timestamp <= p.predicted_at
           AND (hp.candle_timestamp + interval '6 hours')::date = p.predicted_at::date
           AND hp.created_at <= p.predicted_at
         LIMIT 1
       ) lc ON true
       WHERE p.horizon = 'next_day' AND p.target_label = 'next_day_return'
         AND p.predicted_at >= $1::date
         AND abs(v.realized_return) <= 0.5
       ORDER BY p.exchange, p.symbol, p.predicted_at::date, p.predicted_at DESC
     ),
     grouped AS (
       SELECT *,
              realized - avg(realized) OVER (PARTITION BY day) AS vs_market,
              CASE WHEN close < 500 THEN 'penny'
                   WHEN close < 5000 THEN 'mid'
                   WHEN close < 10000 THEN 'upper'
                   ELSE 'high_risk' END AS band
       FROM verified
     ),
     ranked AS (
       SELECT *,
              row_number() OVER (PARTITION BY band, day ORDER BY predicted DESC) AS rise_rank,
              row_number() OVER (PARTITION BY band, day ORDER BY predicted ASC) AS fall_rank,
              percent_rank() OVER (PARTITION BY band, day ORDER BY predicted) AS predicted_rank,
              percent_rank() OVER (PARTITION BY band, day ORDER BY vs_market) AS outcome_rank
       FROM grouped
     )
     SELECT band,
            count(*)::int AS rows,
            count(DISTINCT day)::int AS days,
            avg(CASE WHEN (predicted > 0) = (realized > 0) THEN 1.0 ELSE 0.0 END)::float8 AS direction_correct,
            corr(predicted_rank, outcome_rank)::float8 AS rank_correlation,
            avg(realized) FILTER (WHERE rise_rank <= $2 AND predicted > 0)::float8 AS rise_actual,
            avg(vs_market) FILTER (WHERE rise_rank <= $2 AND predicted > 0)::float8 AS rise_vs_market,
            avg(realized) FILTER (WHERE fall_rank <= $2 AND predicted < 0)::float8 AS fall_actual,
            avg(vs_market) FILTER (WHERE fall_rank <= $2 AND predicted < 0)::float8 AS fall_vs_market
     FROM ranked
     GROUP BY band`,
    [from, GROUP_TOP_N]
  );
  return { topN: GROUP_TOP_N, groups: result.rows };
}

const CLASSIFICATION_TARGETS = new Set(["p_move_up_2pct", "p_move_down_2pct"]);

// Calibration + confusion matrix for a binary target, over every verified
// prediction. Calibration bins are quantile bins (ntile) rather than equal-
// width ones: predicted probabilities here cluster in 0-30%, so equal-width
// bins would cram nearly everything into the first one or two.
async function getClassificationMetrics({ horizon = "next_day", targetLabel, bins = 10, threshold = 0.1 } = {}) {
  if (!CLASSIFICATION_TARGETS.has(targetLabel)) {
    throw new Error(`targetLabel must be one of: ${[...CLASSIFICATION_TARGETS].join(", ")}`);
  }
  const binCount = Math.min(Math.max(parseInt(bins, 10) || 10, 2), 20);
  const cutoff = Math.min(Math.max(Number(threshold) || 0.1, 0), 1);

  const verified = `
    SELECT p.predicted_value::float8 AS prob, v.actual_value::float8 AS actual
    FROM prediction_verification v
    JOIN predictions p ON p.id = v.prediction_id AND p.predicted_at = v.prediction_predicted_at
    WHERE p.horizon = $1 AND p.target_label = $2`;

  const [binsResult, summaryResult] = await Promise.all([
    db.query(
      `SELECT bin::int,
              count(*)::int AS n,
              avg(prob) AS mean_predicted,
              avg(actual) AS observed_rate,
              min(prob) AS min_predicted,
              max(prob) AS max_predicted
       FROM (SELECT prob, actual, ntile($3) OVER (ORDER BY prob) AS bin FROM (${verified}) t) b
       GROUP BY bin
       ORDER BY bin`,
      [horizon, targetLabel, binCount]
    ),
    db.query(
      `SELECT count(*)::int AS n,
              avg(actual) AS base_rate,
              avg(power(prob - actual, 2)) AS brier,
              count(*) FILTER (WHERE prob >= $3 AND actual = 1)::int AS tp,
              count(*) FILTER (WHERE prob >= $3 AND actual = 0)::int AS fp,
              count(*) FILTER (WHERE prob <  $3 AND actual = 1)::int AS fn,
              count(*) FILTER (WHERE prob <  $3 AND actual = 0)::int AS tn
       FROM (${verified}) t`,
      [horizon, targetLabel, cutoff]
    ),
  ]);

  const summary = summaryResult.rows[0];
  const { tp, fp, fn } = summary;
  return {
    horizon,
    targetLabel,
    threshold: cutoff,
    bins: binsResult.rows,
    summary: {
      ...summary,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
  };
}

async function getCurrentModel(horizon) {
  const conditions = ["status = 'production'"];
  const values = [];
  if (horizon) {
    values.push(horizon);
    conditions.push(`horizon = $${values.length}`);
  }

  const result = await db.query(
    `SELECT id, model_name, horizon, target_label, algorithm, version_tag,
            feature_set_version, trained_at, train_window_start, train_window_end,
            status, metrics
     FROM model_versions
     WHERE ${conditions.join(" AND ")}
     ORDER BY trained_at DESC`,
    values
  );
  return result.rows;
}

async function getModelVersions(horizon) {
  const conditions = [];
  const values = [];
  if (horizon) {
    values.push(horizon);
    conditions.push(`horizon = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query(
    `SELECT id, model_name, horizon, target_label, algorithm, version_tag,
            feature_set_version, trained_at, train_window_start, train_window_end,
            status, metrics
     FROM model_versions
     ${where}
     ORDER BY trained_at DESC`,
    values
  );
  return result.rows;
}

async function getRankings({ date, category } = {}) {
  const conditions = [];
  const values = [];

  if (date) {
    values.push(date);
    conditions.push(`r.ranking_date = $${values.length}`);
  }
  if (category) {
    values.push(category);
    conditions.push(`r.category = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query(
    `SELECT r.id, r.ranking_date, r.category, r.rank, r.exchange, r.symbol, r.score,
            p.predicted_value, p.confidence, p.explanation
     FROM daily_rankings r
     JOIN predictions p ON p.id = r.prediction_id AND p.predicted_at = r.prediction_predicted_at
     ${where}
     ORDER BY r.category, r.rank ASC`,
    values
  );
  return result.rows;
}

module.exports = {
  getPriceGroupPerformance,
  getPriceGroupStocks,
  getClassificationMetrics,
  getPredictions,
  getPredictionById,
  getVerification,
  getAccuracy,
  getCurrentModel,
  getModelVersions,
  getRankings,
  getSectors,
};
