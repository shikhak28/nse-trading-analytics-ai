const db = require("../config/db");
const redis = require("../config/redis");

// IST calendar date (YYYY-MM-DD) of a timestamp.
function istDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// The newest prediction batch (IST day). Only it is still "live": an older
// batch's predicted day has already finished.
async function latestBatchDay() {
  const { rows } = await db.query(
    `SELECT max(predicted_at) AS at FROM predictions
     WHERE horizon = 'next_day' AND predicted_at >= now() - interval '30 days'`
  );
  return rows[0]?.at ? istDay(rows[0].at) : null;
}

/**
 * While the predicted day is still trading (its EOD candle isn't synced
 * yet), fills actual_return from the live quote: ltp vs the close the
 * prediction was made from. Marked actual_live so the page can say "Live".
 * Only for today's session and the newest batch -- an older prediction
 * with no candle must not pick up today's price.
 */
async function attachLiveActual(rows) {
  const pending = rows.filter((r) => r.actual_return == null && r.last_close != null && r.predicted_at);
  if (pending.length === 0) return rows;

  const today = istDay(Date.now());
  const latest = await latestBatchDay();
  const recent = pending.filter((r) => {
    const madeOn = istDay(r.predicted_at);
    return madeOn === latest && madeOn < today;
  });
  if (recent.length === 0) return rows;

  const symbols = [...new Set(recent.map((r) => r.symbol))];
  const pipeline = redis.pipeline();
  for (const symbol of symbols) pipeline.hmget(`quote:${symbol}`, "ltp", "updated_at");
  const results = await pipeline.exec();

  const live = new Map();
  symbols.forEach((symbol, i) => {
    const [ltp, updatedAt] = results[i]?.[1] || [];
    if (ltp != null && istDay(updatedAt) === today) live.set(symbol, Number(ltp));
  });
  if (live.size === 0) return rows;

  return rows.map((r) => {
    if (r.actual_return != null || !live.has(r.symbol) || !recent.includes(r)) return r;
    return { ...r, actual_return: live.get(r.symbol) / Number(r.last_close) - 1, actual_live: true };
  });
}

module.exports = { attachLiveActual };
