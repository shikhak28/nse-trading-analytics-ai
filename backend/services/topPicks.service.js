const db = require("../config/db");
const { getPriceGroupStocks } = require("./prediction.service");
const { VALID_DAY_SQL } = require("./signal");

const TOP_N = 5;
const CACHE_MS = 10 * 60 * 1000;
let cache = null; // { key, at, promise }

const pct = (v) => (v == null ? null : Number((Number(v) * 100).toFixed(2)));

/**
 * For each of the last `days` prediction days that already have results:
 * the top 5 stocks of the three Predictions-page lists (Rise 4%+, Rise 2%+,
 * Expected move), for liquid stocks and for all stocks, with what they
 * actually did the next trading day. Same rules as the Predictions page:
 * the Rise lists only take stocks whose expected move is also positive.
 */
async function getTopPicksHistory({ days = 10 } = {}) {
    const { rows: dayRows } = await db.query(
        `SELECT DISTINCT p.predicted_at::date::text AS day FROM predictions p
         WHERE p.horizon = 'next_day' AND p.target_label = 'p_move_up_2pct'
           AND p.predicted_at >= now() - interval '60 days' AND ${VALID_DAY_SQL}
         ORDER BY 1 DESC`
    );
    const key = `${dayRows[0]?.day}:${days}`;
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.promise;
    const promise = build(dayRows.map((r) => r.day), days).catch((err) => {
        cache = null;
        throw err;
    });
    cache = { key, at: Date.now(), promise };
    return promise;
}

async function build(candidateDays, days) {
    const out = [];
    for (const day of candidateDays) {
        if (out.length >= days) break;
        const stocks = await getPriceGroupStocks({ date: day });
        const withActual = stocks.filter((s) => s.actual_return != null);
        // The newest batch is still trading (or not synced yet): skip it.
        if (withActual.length < stocks.length / 2) continue;

        const { rows: up4 } = await db.query(
            `SELECT DISTINCT ON (symbol) symbol, predicted_value::float8 AS v FROM predictions
             WHERE horizon = 'next_day' AND target_label = 'p_move_up_4pct'
               AND predicted_at >= $1::date AND predicted_at < $1::date + 1
             ORDER BY symbol, predicted_at DESC`,
            [day]
        );
        const p4 = new Map(up4.map((r) => [r.symbol, r.v]));

        const rows = withActual.map((s) => ({ ...s, chance_up_4: p4.get(s.symbol) ?? null }));
        const agree = rows.filter((s) => s.expected_return > 0);
        const byDesc = (field) => (a, b) => b[field] - a[field];
        const top = (list, liquid) => (liquid ? list.filter((s) => s.liquid) : list).slice(0, TOP_N);

        const up4List = agree.filter((s) => s.chance_up_4 != null).sort(byDesc("chance_up_4"));
        const up2List = agree.filter((s) => s.chance_up != null).sort(byDesc("chance_up"));
        const expList = [...rows].sort(byDesc("expected_return"));
        const picks = {
            up4: { liquid: top(up4List, true), all: top(up4List, false) },
            up2: { liquid: top(up2List, true), all: top(up2List, false) },
            exp: { liquid: top(expList, true), all: top(expList, false) },
        };

        // Next day's open for every picked stock, for the "opened at" column.
        const symbols = [...new Set(Object.values(picks).flatMap((g) => [...g.liquid, ...g.all]).map((s) => s.symbol))];
        const madeAt = rows[0]?.predicted_at;
        const { rows: opens } = symbols.length
            ? await db.query(
                  `SELECT DISTINCT ON (symbol) symbol, open::float8 AS open FROM historical_prices
                   WHERE exchange = 'NSE' AND interval = 'day' AND symbol = ANY($1)
                     AND candle_timestamp > $2 AND candle_timestamp < $2::timestamp + interval '10 days'
                   ORDER BY symbol, candle_timestamp`,
                  [symbols, madeAt]
              )
            : { rows: [] };
        const openOf = new Map(opens.map((r) => [r.symbol, r.open]));

        const shape = (s) => ({
            symbol: s.symbol,
            company: s.company_name,
            chanceUp4: pct(s.chance_up_4),
            chanceUp2: pct(s.chance_up),
            expected: pct(s.expected_return),
            actual: pct(s.actual_return),
            openedAt: openOf.has(s.symbol) && s.last_close ? pct(openOf.get(s.symbol) / s.last_close - 1) : null,
        });
        const lists = {};
        for (const [name, group] of Object.entries(picks)) {
            lists[name] = { liquid: group.liquid.map(shape), all: group.all.map(shape) };
        }
        out.push({
            day,
            resultDay: withActual[0]?.actual_day ?? null,
            hasUp4Model: p4.size > 0,
            lists,
        });
    }
    return out;
}

module.exports = { getTopPicksHistory };
