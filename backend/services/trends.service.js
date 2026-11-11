const db = require("../config/db");

// A "month" here is 21 trading days, counted back from each stock's newest
// day candle (calendar months would make the current, partial month count).
// A stock is "rising" when every one of its last 3 monthly closes beat the
// one before, and "falling" when each of its last 6 came in below.
const MONTH = 21;
const RISING_MONTHS = 3;
const FALLING_MONTHS = 6;

// The scan takes ~30 s and the answer only changes once a day after the EOD
// sync, so visitors are always served from memory: a stale result is
// returned at once while a fresh one is computed in the background.
const REFRESH_MS = 30 * 60 * 1000;
let cache = null;
let inFlight = null;

async function computeTrends() {
  // One indexed lookup per company (exchange, symbol, interval, timestamp)
  // instead of a range scan: historical_prices also holds minute candles, so
  // a scan filtered only on interval = 'day' reads millions of rows (~2 min
  // vs ~30 s this way).
  const result = await db.query(
    `SELECT c.exchange, c.symbol, c.company_name, t.pts, t.avg_traded_value
     FROM companies c
     CROSS JOIN LATERAL (
       -- Monthly checkpoints, newest first: pts[1] = latest close,
       -- pts[2] = 21 trading days back, and so on.
       SELECT array_agg(x.close::float8 ORDER BY x.k) FILTER (WHERE x.k % ${MONTH} = 0) AS pts,
              max(x.candle_timestamp) AS last_candle_at,
              avg(x.close * x.volume) FILTER (WHERE x.k < 20)::float8 AS avg_traded_value
       FROM (
         SELECT hp.close, hp.volume, hp.candle_timestamp,
                row_number() OVER (ORDER BY hp.candle_timestamp DESC) - 1 AS k
         FROM historical_prices hp
         WHERE hp.exchange = c.exchange AND hp.symbol = c.symbol AND hp.interval = 'day'
           AND hp.candle_timestamp >= now() - interval '210 days'
         ORDER BY hp.candle_timestamp DESC
         LIMIT ${MONTH * FALLING_MONTHS + 1}
       ) x
     ) t
     WHERE c.excluded_reason IS NULL
       -- Skip stocks that stopped trading: their newest candle must be recent.
       AND t.last_candle_at >= now() - interval '10 days'`
  );

  const rising = [];
  const falling = [];

  for (const row of result.rows) {
    const pts = row.pts || [];
    const base = {
      exchange: row.exchange,
      symbol: row.symbol,
      company_name: row.company_name,
      last_close: pts[0],
      avg_traded_value: row.avg_traded_value,
    };

    if (pts.length > RISING_MONTHS && isMonotonic(pts, RISING_MONTHS, (newer, older) => newer > older)) {
      rising.push({ ...base, ...summarise(pts, RISING_MONTHS) });
    }
    if (pts.length > FALLING_MONTHS && isMonotonic(pts, FALLING_MONTHS, (newer, older) => newer < older)) {
      falling.push({ ...base, ...summarise(pts, FALLING_MONTHS) });
    }
  }

  rising.sort((a, b) => b.total_change - a.total_change);
  falling.sort((a, b) => a.total_change - b.total_change);
  return { rising, falling, risingMonths: RISING_MONTHS, fallingMonths: FALLING_MONTHS };
}

function isMonotonic(pts, months, compare) {
  for (let i = 0; i < months; i++) {
    if (!compare(pts[i], pts[i + 1])) return false;
  }
  return true;
}

// Monthly % changes, oldest month first, plus the total over the window.
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

async function getTrends() {
  if (!cache) await refresh();
  else if (Date.now() - cache.at > REFRESH_MS) refresh().catch((err) => console.error("[trends] refresh failed:", err.message));
  return { ...cache.data, computedAt: cache.at };
}

// Warm the cache shortly after the server starts, so the first visitor
// doesn't wait for the scan either.
setTimeout(() => refresh().catch((err) => console.error("[trends] warm-up failed:", err.message)), 15000).unref();

module.exports = { getTrends };
