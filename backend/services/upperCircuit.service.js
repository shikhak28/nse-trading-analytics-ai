const db = require("../config/db");
const { LIQUID_MIN_VALUE } = require("./signal");

// Stocks that rose 5% or more in a day (from daily candles), in three ranges
// -- 5-10%, 10-20%, 20%+ -- each flagged if it closed locked at an upper
// circuit: closed at the day's high, and the change equals a circuit band
// (2/5/10/20%) to within one price tick (0.01) or 0.15 points. A stock that
// touched the circuit and fell back is not flagged: the day's real circuit
// limit is not stored.
const ALL_BANDS = [2, 5, 10, 20];
// Ranges by the day's change. 4.9 / 9.9 / 19.9 so that a 5% / 10% / 20%
// circuit (often +4.97% or +9.99% after tick rounding) lands in its range.
const RANGES = [
    { key: "20+", min: 19.9 },
    { key: "10-20", min: 9.9 },
    { key: "5-10", min: 4.9 },
];
const rangeOf = (chg) => RANGES.find((r) => chg >= r.min)?.key ?? null;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

async function getUpperCircuits({ days = 10 } = {}) {
    const key = String(days);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = build(days).catch((err) => {
        cache.delete(key);
        throw err;
    });
    cache.set(key, { at: Date.now(), promise });
    return promise;
}

async function build(days) {
    // Trading days = days RELIANCE has a daily candle (an index lookup; a
    // scan over all stocks would also read every minute candle). One extra,
    // for the prediction made the evening before the oldest day.
    const { rows: dayRows } = await db.query(
        `SELECT (candle_timestamp + interval '6 hours')::date::text AS day
         FROM historical_prices
         WHERE exchange = 'NSE' AND symbol = 'RELIANCE' AND interval = 'day'
           AND candle_timestamp >= now() - interval '40 days'
         ORDER BY candle_timestamp DESC LIMIT $1`,
        [days + 1]
    );
    const tradingDays = dayRows.map((r) => r.day);
    const shown = tradingDays.slice(0, days);
    if (!shown.length) return { days: [], rows: [] };
    const prevDay = new Map(shown.map((d, i) => [d, tradingDays[i + 1] ?? null]));

    const { rows } = await db.query(
        `WITH d AS (
           -- Per company, so each read is an index range on daily candles.
           SELECT c.symbol, (hp.candle_timestamp + interval '6 hours')::date AS day,
                  hp.high::float8 AS high, hp.close::float8 AS close, hp.volume::float8 AS volume,
                  lag(hp.close) OVER (PARTITION BY c.symbol ORDER BY hp.candle_timestamp)::float8 AS pc
           FROM companies c
           CROSS JOIN LATERAL (
             SELECT h.candle_timestamp, h.high, h.close, h.volume FROM historical_prices h
             WHERE h.exchange = c.exchange AND h.symbol = c.symbol AND h.interval = 'day'
               AND h.candle_timestamp >= $1::date - interval '10 days'
           ) hp
           WHERE c.exchange = 'NSE'
         ), m AS (
           -- Nearest circuit band to the day's change, for the circuit flag.
           SELECT DISTINCT ON (d.symbol, d.day) d.*, b.band, (d.close / d.pc - 1) * 100 AS chg
           FROM d CROSS JOIN unnest($2::int[]) AS b(band)
           WHERE d.pc > 0 AND d.close >= d.pc * 1.049 AND d.day >= $1::date
           ORDER BY d.symbol, d.day, abs((d.close / d.pc - 1) * 100 - b.band)
         )
         SELECT m.day::text AS day, m.symbol, c.company_name, c.sector, m.pc AS prev_close, m.close, m.chg, m.volume,
                CASE WHEN m.close >= m.high - 0.001
                      AND abs(m.chg - m.band) <= greatest(0.15, 100 * 0.011 / m.pc)
                      AND abs(m.chg - m.band) < m.band * 0.25
                     THEN m.band END AS circuit
         FROM m JOIN companies c ON c.exchange = 'NSE' AND c.symbol = m.symbol
         ORDER BY m.day DESC, m.chg DESC`,
        [shown.at(-1), ALL_BANDS]
    );
    if (!rows.length) return { days: shown, rows: [] };

    // What the model said the evening before, and where it ranked the stock
    // in the 4%+ list, plus 20-day average traded value for the liquid flag.
    const evenings = [...new Set(rows.map((r) => prevDay.get(r.day)).filter(Boolean))];
    const { rows: preds } = await db.query(
        `WITH p AS (
           SELECT DISTINCT ON (symbol, target_label, predicted_at::date)
                  symbol, target_label, predicted_at::date::text AS evening, predicted_value::float8 AS v
           FROM predictions
           WHERE horizon = 'next_day' AND predicted_at >= $2::date AND predicted_at < $3::date + 1
             AND predicted_at::date = ANY($1::date[])
             AND target_label IN ('p_move_up_2pct', 'p_move_up_4pct', 'next_day_return')
           ORDER BY symbol, target_label, predicted_at::date, predicted_at DESC
         )
         SELECT p.*, CASE WHEN target_label = 'p_move_up_4pct'
                          THEN rank() OVER (PARTITION BY evening, target_label ORDER BY v DESC) END AS rank
         FROM p`,
        [evenings, evenings.reduce((a, b) => (a < b ? a : b)), evenings.reduce((a, b) => (a > b ? a : b))]
    );
    const model = new Map();
    for (const p of preds) {
        const k = `${p.evening}:${p.symbol}`;
        const m = model.get(k) || {};
        if (p.target_label === "p_move_up_2pct") m.chanceUp2 = p.v;
        if (p.target_label === "p_move_up_4pct") {
            m.chanceUp4 = p.v;
            m.rankUp4 = Number(p.rank);
        }
        if (p.target_label === "next_day_return") m.expected = p.v;
        model.set(k, m);
    }
    // The average stock's chance each evening: a chance is shown as "times
    // normal" against it, since 12% for a 4% jump is high when the average
    // stock gets 4%.
    const avg = new Map(); // `${evening}:${label}` -> { sum, n }
    for (const p of preds) {
        if (p.target_label === "next_day_return") continue;
        const k = `${p.evening}:${p.target_label}`;
        const a = avg.get(k) || { sum: 0, n: 0 };
        a.sum += p.v;
        a.n += 1;
        avg.set(k, a);
    }
    const timesNormal = (v, evening, label) => {
        const a = avg.get(`${evening}:${label}`);
        return v == null || !a?.n ? null : Number((v / (a.sum / a.n)).toFixed(1));
    };

    const symbols = [...new Set(rows.map((r) => r.symbol))];
    const { rows: tv } = await db.query(
        `SELECT symbol, avg(close * volume)::float8 AS avg_value FROM (
           SELECT symbol, close, volume, row_number() OVER (PARTITION BY symbol ORDER BY candle_timestamp DESC) AS rn
           FROM historical_prices
           WHERE exchange = 'NSE' AND interval = 'day' AND symbol = ANY($1)
             AND candle_timestamp >= now() - interval '45 days'
         ) x WHERE rn <= 20 GROUP BY symbol`,
        [symbols]
    );
    const avgValue = new Map(tv.map((r) => [r.symbol, r.avg_value]));

    const pct = (v) => (v == null ? null : Number((v * 100).toFixed(2)));
    return {
        days: shown,
        rows: rows.map((r) => {
            const evening = prevDay.get(r.day);
            const m = model.get(`${evening}:${r.symbol}`) || {};
            return {
                day: r.day,
                symbol: r.symbol,
                company: r.company_name,
                sector: r.sector,
                range: rangeOf(r.chg),
                circuit: r.circuit,
                prevClose: Number(r.prev_close.toFixed(2)),
                close: Number(r.close.toFixed(2)),
                change: Number(r.chg.toFixed(2)),
                liquid: !/-(BE|BZ|SM|ST)$/.test(r.symbol) && (avgValue.get(r.symbol) ?? 0) >= LIQUID_MIN_VALUE,
                chanceUp2: pct(m.chanceUp2),
                chanceUp4: pct(m.chanceUp4),
                timesNormalUp2: timesNormal(m.chanceUp2, evening, "p_move_up_2pct"),
                timesNormalUp4: timesNormal(m.chanceUp4, evening, "p_move_up_4pct"),
                rankUp4: m.rankUp4 ?? null,
                expected: pct(m.expected),
            };
        }),
    };
}

module.exports = { getUpperCircuits };
