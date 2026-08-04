const db = require("../config/db");

async function getPredictions({ symbol, exchange, horizon, date, limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const values = [];

  if (symbol) {
    values.push(symbol);
    conditions.push(`symbol = $${values.length}`);
  }
  if (exchange) {
    values.push(exchange);
    conditions.push(`exchange = $${values.length}`);
  }
  if (horizon) {
    values.push(horizon);
    conditions.push(`horizon = $${values.length}`);
  }
  if (date) {
    values.push(date);
    conditions.push(`predicted_at::date = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(Number(limit));
  values.push(Number(offset));

  const result = await db.query(
    `SELECT id, exchange, symbol, predicted_at, horizon, target_label, model_version_id,
            predicted_value, predicted_low, predicted_high, confidence, explanation
     FROM predictions
     ${where}
     ORDER BY predicted_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return result.rows;
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
    values.push(symbol);
    conditions.push(`p.symbol = $${values.length}`);
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

  const conditions = [];
  const values = [];

  if (horizon) {
    values.push(horizon);
    conditions.push(`p.horizon = $${values.length}`);
  }
  if (targetLabel) {
    values.push(targetLabel);
    conditions.push(`p.target_label = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

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

module.exports = {
  getPredictions,
  getPredictionById,
  getVerification,
  getAccuracy,
  getCurrentModel,
  getModelVersions,
};
