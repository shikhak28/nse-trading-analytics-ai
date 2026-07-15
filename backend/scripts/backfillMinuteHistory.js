const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "..", "..", ".env"),
  override: true,
});

const db = require("../config/db");
const { enqueueSymbolSync } = require("../queues");

// One-off trigger for the 3-year minute-candle backfill across every
// tracked company (or a single exchange, if passed as an argv filter --
// e.g. `node backfillMinuteHistory.js BSE`). Enqueues into the same
// historical-sync queue the daily job uses -- historicalSync.job.js already
// does the full BACKFILL_YEARS lookback for any interval when a symbol has
// no stored candles yet, and the worker's shared 3 req/sec limiter
// (historicalWorker.js) throttles the whole run automatically. Expect this to take
// hours for a few thousand symbols; the worker process must stay running
// until the queue drains, but BullMQ jobs persist in Redis so an
// interrupted run picks back up safely.
async function main() {
    const exchangeFilter = process.argv[2]?.toUpperCase();
    const result = exchangeFilter
        ? await db.query(`SELECT exchange, symbol FROM companies WHERE exchange = $1 ORDER BY symbol ASC`, [exchangeFilter])
        : await db.query(`SELECT exchange, symbol FROM companies ORDER BY exchange ASC, symbol ASC`);

    for (const row of result.rows) {
        await enqueueSymbolSync(row.symbol, "minute", row.exchange);
    }

    console.log(`[backfill-minute-history] enqueued ${result.rows.length} symbols for minute-interval sync${exchangeFilter ? ` (${exchangeFilter} only)` : ""}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[backfill-minute-history] failed:", err.message);
        process.exit(1);
    });
