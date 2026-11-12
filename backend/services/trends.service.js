const db = require("../config/db");
const { getPriceGroupStocks } = require("./prediction.service");
const { attachLiveActual } = require("./liveActual");

// Steps are counted in trading days back from each stock's newest day
// candle (calendar periods would make the current, partial one count). A
// stock is "rising" over a period when every step closed above the one
// before it, and "falling" when every step closed below.
const PERIODS = [
  { key: "1w", label: "1 week", stepLabel: "day", step: 1, steps: 5 },
  { key: "1m", label: "1 month", stepLabel: "week", step: 5, steps: 4 },
];
const MAX_LOOKBACK = Math.max(...PERIODS.map((p) => p.step * p.steps));

// The scan takes ~30 s and the answer only changes once a day after the EOD
// sync, so visitors are always served from memory: a stale result is
// returned at once while a fresh one is computed in the background.
const REFRESH_MS = 30 * 60 * 1000;
let cache = null;
let inFlight = null;

// Past dates never change, so their scans are kept (a few, newest used).
const PAST_CACHE_MAX = 6;
const pastCache = new Map();

// asOf (YYYY-MM-DD, IST trading day) = trends as they stood at that day's
// close; null = latest. A day candle for IST day X is stored at 18:30 UTC
// on X-1, so "candle_timestamp < X" includes X itself.
async function computeTrends(asOf = null) {
  const params = asOf ? [asOf] : [];
  const end = asOf ? "$1::date" : "now()";
  const until = asOf ? "AND hp.candle_timestamp < $1::date" : "";
  // One indexed lookup per company (exchange, symbol, interval, timestamp)
  // instead of a range scan: historical_prices also holds minute candles, so
  // a scan filtered only on interval = 'day' reads millions of rows (~2 min
  // vs ~30 s this way).
  const result = await db.query(
    `SELECT c.exchange, c.symbol, c.company_name, t.closes, t.last_volume, t.avg_traded_value
     FROM companies c
     CROSS JOIN LATERAL (
       -- Daily closes, newest first: closes[1] = latest, closes[2] = the
       -- trading day before, and so on.
       SELECT array_agg(x.close::float8 ORDER BY x.k) AS closes,
              max(x.candle_timestamp) AS last_candle_at,
              max(x.volume) FILTER (WHERE x.k = 0)::float8 AS last_volume,
              avg(x.close * x.volume) FILTER (WHERE x.k < 20)::float8 AS avg_traded_value
       FROM (
         SELECT hp.close, hp.volume, hp.candle_timestamp,
                row_number() OVER (ORDER BY hp.candle_timestamp DESC) - 1 AS k
         FROM historical_prices hp
         WHERE hp.exchange = c.exchange AND hp.symbol = c.symbol AND hp.interval = 'day'
           AND hp.candle_timestamp >= ${end} - interval '60 days' ${until}
         ORDER BY hp.candle_timestamp DESC
         LIMIT ${MAX_LOOKBACK + 1}
       ) x
     ) t
     WHERE c.excluded_reason IS NULL
       -- Skip stocks that stopped trading: their newest candle must be recent.
       AND t.last_candle_at >= ${end} - interval '10 days'`,
    params
  );

  const periods = Object.fromEntries(PERIODS.map((p) => [p.key, { rising: [], falling: [] }]));

  for (const row of result.rows) {
    const closes = row.closes || [];
    const base = {
      exchange: row.exchange,
      symbol: row.symbol,
      company_name: row.company_name,
      last_close: closes[0],
      last_volume: row.last_volume,
      avg_traded_value: row.avg_traded_value,
    };

    for (const period of PERIODS) {
      // Checkpoints newest first: latest close, one step back, two steps...
      const pts = [];
      for (let i = 0; i <= period.steps; i++) pts.push(closes[i * period.step]);
      if (pts.some((v) => v == null)) continue;

      if (isMonotonic(pts, period.steps, (newer, older) => newer > older)) {
        periods[period.key].rising.push({ ...base, ...summarise(pts, period.steps) });
      } else if (isMonotonic(pts, period.steps, (newer, older) => newer < older)) {
        periods[period.key].falling.push({ ...base, ...summarise(pts, period.steps) });
      }
    }
  }

  for (const lists of Object.values(periods)) {
    lists.rising.sort((a, b) => b.total_change - a.total_change);
    lists.falling.sort((a, b) => a.total_change - b.total_change);
  }
  return { periods, periodInfo: PERIODS };
}

function isMonotonic(pts, months, compare) {
  for (let i = 0; i < months; i++) {
    if (!compare(pts[i], pts[i + 1])) return false;
  }
  return true;
}

// % change of each step, oldest first, plus the total over the window.
function summarise(pts, months) {
  const monthly = [];
  for (let i = months - 1; i >= 0; i--) monthly.push(pts[i] / pts[i + 1] - 1);
  return { start_close: pts[months], total_change: pts[0] / pts[months] - 1, monthly };
}

function refresh() {
  if (!inFlight) {
    inFlight = computeTrends()
      .then((data) => {
        cache = { at: Date.now(), data };
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

// The newest day with next_day predictions, skipping known-bad days.
async function latestPredictionDay() {
  const result = await db.query(
    `SELECT to_char(max(p.predicted_at)::date, 'YYYY-MM-DD') AS day
     FROM predictions p
     WHERE p.horizon = 'next_day'
       AND p.predicted_at >= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM invalid_prediction_days ipd WHERE ipd.day = p.predicted_at::date)`
  );
  return result.rows[0]?.day || null;
}

// Adds the latest model view (expected move, chances, Signal) to each trend
// stock. Fetched per request (~0.3 s) so it's fresh right after predict.py
// runs, while the slow trend scan stays cached.
async function withPredictions(data, asOf = null) {
  const day = asOf || (await latestPredictionDay());
  if (!day) return { ...data, predictionDay: null };
  const rows = await attachLiveActual(await getPriceGroupStocks({ date: day }));
  const preds = new Map(rows.map((p) => [`${p.exchange}:${p.symbol}`, p]));
  const attach = (s) => {
    const p = preds.get(`${s.exchange}:${s.symbol}`);
    return {
      ...s,
      expected_return: p?.expected_return ?? null,
      chance_up: p?.chance_up ?? null,
      chance_down: p?.chance_down ?? null,
      signal: p?.signal ?? null,
      // What the predicted day actually did (live while it's trading).
      actual_return: p?.actual_return ?? null,
      actual_live: p?.actual_live ?? false,
    };
  };
  const periods = Object.fromEntries(
    Object.entries(data.periods).map(([key, lists]) => [key, { rising: lists.rising.map(attach), falling: lists.falling.map(attach) }])
  );
  return { ...data, periods, predictionDay: day };
}

async function getPastTrends(asOf) {
  if (!pastCache.has(asOf)) {
    const pending = computeTrends(asOf);
    pastCache.set(asOf, pending);
    pending.catch(() => pastCache.delete(asOf));
    while (pastCache.size > PAST_CACHE_MAX) pastCache.delete(pastCache.keys().next().value);
  }
  const data = await pastCache.get(asOf);
  return { ...(await withPredictions(data, asOf)), asOf };
}

async function getTrends({ asOf = null } = {}) {
  if (asOf) return getPastTrends(asOf);
  if (!cache) await refresh();
  else if (Date.now() - cache.at > REFRESH_MS) refresh().catch((err) => console.error("[trends] refresh failed:", err.message));
  return { ...(await withPredictions(cache.data)), computedAt: cache.at };
}

// Warm the cache shortly after the server starts, so the first visitor
// doesn't wait for the scan either.
setTimeout(() => refresh().catch((err) => console.error("[trends] warm-up failed:", err.message)), 15000).unref();

module.exports = { getTrends };
