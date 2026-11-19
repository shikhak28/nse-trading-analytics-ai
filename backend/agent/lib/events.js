const db = require("../../config/db");
const { getPriceGroupStocks } = require("../../services/prediction.service");

// Today in IST (event dates are IST calendar days).
const TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

// One event can have several purposes ("Financial Results/Dividend"), so it
// can fall in more than one category.
const CATEGORIES = [
    ["Results", /result/i],
    ["Dividend", /dividend/i],
    ["Buyback", /buy\s*-?back/i],
    ["Bonus", /bonus/i],
    ["Split", /split|sub-division/i],
    ["Fund Raising", /fund|raising|debenture|\bqip\b|preferential|warrant|rights/i],
];

function categoriesFor(purpose) {
    const hits = CATEGORIES.filter(([, re]) => re.test(purpose || "")).map(([name]) => name);
    return hits.length ? hits : ["Other"];
}

const CATEGORY_NAMES = [...CATEGORIES.map(([name]) => name), "Other"];

const round = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d)));
const pct = (v) => round(v == null ? null : Number(v) * 100);

/**
 * Model's latest next_day view per stock, keyed "NSE:SYMBOL".
 */
async function latestModelView() {
    const { rows } = await db.query(
        `SELECT to_char(max(predicted_at)::date, 'YYYY-MM-DD') AS day FROM predictions
         WHERE horizon = 'next_day' AND predicted_at >= now() - interval '30 days'`
    );
    const day = rows[0]?.day;
    if (!day) return { day: null, byKey: new Map() };
    const preds = await getPriceGroupStocks({ date: day });
    return { day, byKey: new Map(preds.map((p) => [`${p.exchange}:${p.symbol}`, p])) };
}

function modelSummary(p) {
    if (!p) return null;
    return {
        lastClose: round(p.last_close),
        liquid: Boolean(p.liquid),
        expectedMovePct: pct(p.expected_return),
        chanceUp2Pct: pct(p.chance_up),
        chanceDown2Pct: pct(p.chance_down),
        likelyRangePct: p.likely_low == null ? null : [pct(p.likely_low), pct(p.likely_high)],
        signal: p.signal ?? null,
    };
}

/**
 * Price reaction around past events. historical_prices.candle_timestamp is
 * UTC without a zone; a daily candle for IST day D is stored at D-1 18:30, so
 * "before IST day D" is candle_timestamp < D - 5h30m.
 *   day0 = first session on/after the event date
 *   day1 = the session after that (results often come out after the close)
 */
async function pastEventReactions({ symbol, category, daysBack = 730, limit = 2000 } = {}) {
    const values = [daysBack];
    let where = `e.event_date < ${TODAY_SQL} AND e.event_date >= ${TODAY_SQL} - $1::int`;
    if (symbol) {
        values.push(symbol.toUpperCase());
        where += ` AND (e.symbol = $${values.length} OR e.symbol LIKE $${values.length} || '-%')`;
    }
    values.push(limit);
    const { rows } = await db.query(
        `SELECT e.exchange, e.symbol, e.purpose, to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
                p.close::float8 AS prev_close, d.closes
         FROM corporate_events e
         LEFT JOIN LATERAL (
           SELECT h.close FROM historical_prices h
           WHERE h.exchange = e.exchange AND h.symbol = e.symbol AND h.interval = 'day'
             AND h.candle_timestamp < e.event_date::timestamp - interval '5 hours 30 minutes'
           ORDER BY h.candle_timestamp DESC LIMIT 1
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT array_agg(x.close::float8 ORDER BY x.candle_timestamp) AS closes FROM (
             SELECT h.close, h.candle_timestamp FROM historical_prices h
             WHERE h.exchange = e.exchange AND h.symbol = e.symbol AND h.interval = 'day'
               AND h.candle_timestamp >= e.event_date::timestamp - interval '5 hours 30 minutes'
             ORDER BY h.candle_timestamp LIMIT 2
           ) x
         ) d ON true
         WHERE ${where}
         ORDER BY e.event_date DESC
         LIMIT $${values.length}`,
        values
    );

    return rows
        .map((r) => {
            const [c0, c1] = r.closes || [];
            const day0 = r.prev_close && c0 ? c0 / r.prev_close - 1 : null;
            const day1 = c0 && c1 ? c1 / c0 - 1 : null;
            const twoDay = r.prev_close && c1 ? c1 / r.prev_close - 1 : null;
            return {
                symbol: r.symbol,
                eventDate: r.event_date,
                purpose: r.purpose,
                categories: categoriesFor(r.purpose),
                day0Pct: pct(day0),
                day1Pct: pct(day1),
                twoDayPct: pct(twoDay),
            };
        })
        .filter((r) => !category || r.categories.some((c) => c.toLowerCase() === category.toLowerCase()));
}

/**
 * Average absolute daily move over the last ~60 sessions -- the "normal day"
 * baseline to compare event-day moves against.
 */
async function typicalDailyMove(symbol) {
    const { rows } = await db.query(
        `SELECT avg(abs(close / NULLIF(prev, 0) - 1))::float8 AS avg_abs FROM (
           SELECT close, lag(close) OVER (ORDER BY candle_timestamp) AS prev FROM (
             SELECT close, candle_timestamp FROM historical_prices
             WHERE exchange = 'NSE' AND symbol = $1 AND interval = 'day'
             ORDER BY candle_timestamp DESC LIMIT 61
           ) last
         ) moves WHERE prev IS NOT NULL`,
        [symbol.toUpperCase()]
    );
    return pct(rows[0]?.avg_abs);
}

async function eventHistoryCoverage() {
    const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE event_date < ${TODAY_SQL})::int AS past_events,
                to_char(min(event_date), 'YYYY-MM-DD') AS earliest
         FROM corporate_events`
    );
    return rows[0];
}

module.exports = {
    TODAY_SQL,
    CATEGORY_NAMES,
    categoriesFor,
    latestModelView,
    modelSummary,
    pastEventReactions,
    typicalDailyMove,
    eventHistoryCoverage,
    round,
};
