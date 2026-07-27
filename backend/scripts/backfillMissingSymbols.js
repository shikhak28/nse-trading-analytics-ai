const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const db = require("../config/db");
const { enqueueSymbolSync } = require("../queues");

const interval = process.argv[2] || "minute";

/**
 * Finds every company with zero stored candles for `interval` (default
 * "minute") and enqueues a resumable sync for just those -- unlike
 * backfillMinuteHistory.js (which re-enqueues ALL companies every time),
 * this only targets the actual gap, so it's cheap to re-run after an export
 * or a status check turns up a handful of missing symbols. Same queue/
 * worker as everything else -- historicalWorker.js must be running to
 * actually process it.
 */
async function main() {
    const result = await db.query(`
        SELECT c.exchange, c.symbol
        FROM companies c
        WHERE NOT EXISTS (
            SELECT 1 FROM historical_prices h
            WHERE h.exchange = c.exchange AND h.symbol = c.symbol AND h.interval = $1
        )
        ORDER BY c.exchange, c.symbol
    `, [interval]);

    for (const row of result.rows) {
        await enqueueSymbolSync(row.symbol, interval, row.exchange);
    }

    console.log(`[backfill-missing] enqueued ${result.rows.length} companies missing ${interval}-interval data`);
    if (result.rows.length > 0) {
        console.log(result.rows.map((r) => `${r.exchange}:${r.symbol}`).join(", "));
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[backfill-missing] failed:", err.message);
        process.exit(1);
    });
