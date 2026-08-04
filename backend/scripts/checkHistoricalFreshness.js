const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");

// Reports whether historical_prices is up to date: the latest daily candle
// per exchange, and any symbol whose latest daily candle is more than 1 day
// old (or missing entirely) -- the "who's actually stale" list that a plain
// MAX(candle_timestamp) can hide behind.
(async () => {
    const overall = await db.query(`
        SELECT exchange, MAX(candle_timestamp)::date AS latest, COUNT(DISTINCT symbol) AS symbols
        FROM historical_prices
        WHERE interval = 'day'
        GROUP BY exchange
        ORDER BY exchange
    `);
    console.log("Latest daily candle per exchange:", overall.rows);

    const stale = await db.query(`
        SELECT c.exchange, c.symbol, MAX(h.candle_timestamp)::date AS last_candle
        FROM companies c
        LEFT JOIN historical_prices h
          ON h.exchange = c.exchange AND h.symbol = c.symbol AND h.interval = 'day'
        GROUP BY c.exchange, c.symbol
        HAVING MAX(h.candle_timestamp)::date < CURRENT_DATE - INTERVAL '1 day' OR MAX(h.candle_timestamp) IS NULL
        ORDER BY last_candle NULLS FIRST
    `);

    if (stale.rows.length === 0) {
        console.log("No stale symbols -- everything is up to date.");
    } else {
        console.log(`${stale.rows.length} stale symbol(s):`);
        console.table(stale.rows);
    }

    process.exit(0);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
