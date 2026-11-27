const db = require("../config/db");
const { getPriceGroupStocks } = require("./prediction.service");
const { VALID_DAY_SQL } = require("./signal");

// Stocks that rose 5% to 20% in one day, and what the model said about them
// the evening before. Above 20% is usually a listing, a corporate action or
// bad data, so it is left out.
const MIN_MOVE = 0.05;
const MAX_MOVE = 0.2;
const GAP_UP = 0.03;
const VOLUME_SPIKE = 3;
const BUSY_DAY = 30; // this many liquid movers on one day: the whole market moved
const SECTOR_CLUSTER = 3;

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // day -> { at, promise }

const pct = (v) => (v == null ? null : Number((Number(v) * 100).toFixed(2)));

/** Prediction days of the last 60 days, newest first. */
async function predictionDays() {
    const { rows } = await db.query(
        `SELECT DISTINCT p.predicted_at::date::text AS day FROM predictions p
         WHERE p.horizon = 'next_day' AND p.target_label = 'p_move_up_2pct'
           AND p.predicted_at >= now() - interval '60 days' AND ${VALID_DAY_SQL}
         ORDER BY 1 DESC`
    );
    return rows.map((r) => r.day);
}

/**
 * Big movers for the prediction made on `day` (they moved on the next
 * trading day). Without `day`, the newest prediction day that has results.
 */
async function getBigMovers({ day } = {}) {
    const days = await predictionDays();
    let target = day;
    if (!target) {
        for (const d of days) {
            const stocks = await getPriceGroupStocks({ date: d });
            if (stocks.filter((s) => s.actual_return != null).length >= stocks.length / 2) {
                target = d;
                break;
            }
        }
    }
    if (!target) return { days, day: null, resultDay: null, movers: [], summary: null };

    const hit = cache.get(target);
    if (hit && Date.now() - hit.at < CACHE_MS) return { days, ...(await hit.promise) };
    const promise = build(target).catch((err) => {
        cache.delete(target);
        throw err;
    });
    cache.set(target, { at: Date.now(), promise });
    return { days, ...(await promise) };
}

async function build(day) {
    const stocks = await getPriceGroupStocks({ date: day });
    const { rows: up4 } = await db.query(
        `SELECT DISTINCT ON (symbol) symbol, predicted_value::float8 AS v FROM predictions
         WHERE horizon = 'next_day' AND target_label = 'p_move_up_4pct'
           AND predicted_at >= $1::date AND predicted_at < $1::date + 1
         ORDER BY symbol, predicted_at DESC`,
        [day]
    );
    const p4 = new Map(up4.map((r) => [r.symbol, r.v]));

    // Where each stock sat in the model's lists that evening.
    const rankBy = (list, field) => {
        const ranks = new Map();
        [...list].filter((s) => s[field] != null).sort((a, b) => b[field] - a[field]).forEach((s, i) => ranks.set(s.symbol, i + 1));
        return ranks;
    };
    const withUp4 = stocks.map((s) => ({ ...s, chance_up_4: p4.get(s.symbol) ?? null }));
    const liquid = withUp4.filter((s) => s.liquid);
    const ranks = {
        up2: rankBy(withUp4, "chance_up"),
        up2Liquid: rankBy(liquid, "chance_up"),
        up4Liquid: rankBy(liquid, "chance_up_4"),
        expLiquid: rankBy(liquid, "expected_return"),
    };

    const movers = withUp4.filter((s) => s.actual_return != null && s.actual_return >= MIN_MOVE && s.actual_return <= MAX_MOVE);
    const resultDay = movers[0]?.actual_day ?? stocks.find((s) => s.actual_day)?.actual_day ?? null;
    if (!movers.length) {
        return { day, resultDay, movers: [], summary: { total: 0, liquid: 0, liquidUniverse: liquid.length } };
    }

    // The move day's candle: open (for the gap) and volume (for the spike),
    // plus sector and any corporate event within two days of the move.
    const madeAt = movers[0].predicted_at;
    const { rows: extra } = await db.query(
        `SELECT c.symbol, c.sector, hp.open::float8 AS open, hp.volume::float8 AS volume,
                (SELECT string_agg(e.purpose, '; ') FROM corporate_events e
                  WHERE e.exchange = c.exchange AND e.symbol = c.symbol
                    AND e.event_date BETWEEN $3::date - 2 AND $3::date) AS event
         FROM companies c
         LEFT JOIN LATERAL (
           SELECT h.open, h.volume FROM historical_prices h
           WHERE h.exchange = c.exchange AND h.symbol = c.symbol AND h.interval = 'day'
             AND h.candle_timestamp > $2 AND h.candle_timestamp < $2::timestamp + interval '10 days'
           ORDER BY h.candle_timestamp LIMIT 1
         ) hp ON true
         WHERE c.exchange = 'NSE' AND c.symbol = ANY($1)`,
        [movers.map((s) => s.symbol), madeAt, resultDay]
    );
    const extraOf = new Map(extra.map((r) => [r.symbol, r]));

    const liquidMovers = movers.filter((s) => s.liquid);
    const sectorCount = new Map();
    for (const s of liquidMovers) {
        const sector = extraOf.get(s.symbol)?.sector;
        if (sector) sectorCount.set(sector, (sectorCount.get(sector) || 0) + 1);
    }
    const busyDay = liquidMovers.length >= BUSY_DAY;

    const rows = movers
        .map((s) => {
            const x = extraOf.get(s.symbol) || {};
            const gap = x.open != null && s.last_close ? x.open / s.last_close - 1 : null;
            const volumeX = x.volume != null && s.avg_traded_value ? (x.volume * s.actual_close) / s.avg_traded_value : null;
            const reasons = [];
            if (x.event) reasons.push(`Event: ${x.event}`);
            if (gap != null && gap >= GAP_UP) reasons.push("Opened with a gap up (news before market)");
            if (volumeX != null && volumeX >= VOLUME_SPIKE) reasons.push(`Volume ${volumeX.toFixed(1)}x normal`);
            if (s.liquid && x.sector && sectorCount.get(x.sector) >= SECTOR_CLUSTER) reasons.push(`Sector move (${x.sector})`);
            if (s.liquid && busyDay) reasons.push("Whole market moved");
            return {
                symbol: s.symbol,
                company: s.company_name,
                sector: x.sector ?? null,
                liquid: s.liquid,
                actual: pct(s.actual_return),
                gap: pct(gap),
                volumeX: volumeX == null ? null : Number(volumeX.toFixed(1)),
                chanceUp2: pct(s.chance_up),
                chanceUp4: pct(s.chance_up_4),
                expected: pct(s.expected_return),
                rankUp2: ranks.up2.get(s.symbol) ?? null,
                rankUp2Liquid: s.liquid ? ranks.up2Liquid.get(s.symbol) ?? null : null,
                rankUp4Liquid: s.liquid ? ranks.up4Liquid.get(s.symbol) ?? null : null,
                rankExpLiquid: s.liquid ? ranks.expLiquid.get(s.symbol) ?? null : null,
                reasons,
            };
        })
        .sort((a, b) => b.actual - a.actual);

    // The 20th liquid stock's chance: what a stock needed to make the top 20.
    const liquidByChance = liquid.filter((s) => s.chance_up != null).sort((a, b) => b.chance_up - a.chance_up);
    const top20Cutoff = pct(liquidByChance[19]?.chance_up ?? liquidByChance.at(-1)?.chance_up);
    const inTop = (n) => liquidMovers.filter((s) => (ranks.up2Liquid.get(s.symbol) ?? Infinity) <= n).length;
    return {
        day,
        resultDay,
        movers: rows,
        summary: {
            total: movers.length,
            liquid: liquidMovers.length,
            liquidUniverse: liquid.length,
            liquidInTop20: inTop(20),
            liquidInTop50: inTop(50),
            top20Cutoff,
        },
    };
}

module.exports = { getBigMovers };
