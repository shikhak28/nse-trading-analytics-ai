const db = require("../config/db");
const { getPriceGroupStocks } = require("./prediction.service");

// Below this chance a pick is noise (liquid ETFs and the like score ~0-1%).
const MIN_CHANCE = 10;

// Exchange-traded funds (silver, gold, liquid, index...) are not stock picks.
const isFund = (s) => /\bETF\b|BEES\b/i.test(`${s.company_name || ""} ${s.symbol}`);

const pct = (v) => (v == null ? null : Number((Number(v) * 100).toFixed(2)));

/**
 * The evening's two lists for the daily picks image, liquid stocks only:
 *  - up4: the top `n` by chance of rising 4% or more (a big jump);
 *  - up2: the top `n` by chance of rising 2-4% (chance 2%+ minus chance
 *    4%+: a steady rise), leaving out stocks already in up4.
 * The two chances move together (a jumpy stock scores high on both), so
 * ranking up2 by the 2-4% band is what keeps the lists apart. Expected move
 * is shown, not filtered on: it is negative for most stocks most days.
 *  - positive: every stock with a Positive signal, by chance of 2%+.
 * ETFs and stocks under MIN_CHANCE are left out, so a list can have fewer than `n`.
 */
async function getDailyPicks({ day, n = 20 }) {
    const stocks = (await getPriceGroupStocks({ date: day })).filter((s) => s.liquid && !isFund(s));
    const { rows: up4 } = await db.query(
        `SELECT DISTINCT ON (symbol) symbol, predicted_value::float8 AS v FROM predictions
         WHERE horizon = 'next_day' AND target_label = 'p_move_up_4pct'
           AND predicted_at >= $1::date AND predicted_at < $1::date + 1
         ORDER BY symbol, predicted_at DESC`,
        [day]
    );
    const p4 = new Map(up4.map((r) => [r.symbol, r.v]));
    const rows = stocks.map((s) => {
        const c2 = s.chance_up;
        const c4 = p4.get(s.symbol);
        return {
            symbol: s.symbol,
            company: s.company_name,
            chanceUp2: pct(c2),
            chanceUp4: pct(c4),
            signal: s.signal,
            chanceBand: c2 != null && c4 != null ? pct(Math.max(c2 - c4, 0)) : null,
            expected: pct(s.expected_return),
            lastClose: s.last_close,
        };
    });
    const bigJump = rows
        .filter((r) => r.chanceUp4 >= MIN_CHANCE)
        .sort((a, b) => b.chanceUp4 - a.chanceUp4)
        .slice(0, n);
    const taken = new Set(bigJump.map((r) => r.symbol));
    const steady = rows
        .filter((r) => !taken.has(r.symbol) && r.chanceUp2 >= MIN_CHANCE && r.chanceBand != null)
        .sort((a, b) => b.chanceBand - a.chanceBand)
        .slice(0, n);
    // Every liquid stock with a Positive signal (see signal.js), however many.
    const positive = rows.filter((r) => r.signal === "positive" && r.chanceUp2 != null).sort((a, b) => b.chanceUp2 - a.chanceUp2);
    return { day, stockCount: stocks.length, up4: bigJump, up2: steady, positive };
}

/** True once the evening pipeline has finished for `day` (rank.py is its last step). */
async function pipelineDone(day) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM daily_rankings WHERE ranking_date = $1::date`, [day]);
    return rows[0].n > 0;
}

module.exports = { getDailyPicks, pipelineDone };
