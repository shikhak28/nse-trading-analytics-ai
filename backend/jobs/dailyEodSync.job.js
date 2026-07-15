const db = require("../config/db");
const { enqueueSymbolSync } = require("../queues");

/**
 * Runs after market close (NSE and BSE both close 15:30 IST): enqueue a
 * resumable historical-sync job for every company already tracked in the
 * DB, across every exchange, for both day and minute candles. There's no
 * separate "watchlist" concept yet, so the tracked set is simply whatever's
 * in `companies` -- populated either by a manual sync or by
 * instrument-master-refresh. The historical-sync worker's shared rate
 * limiter (3 req/sec, see historicalWorker.js) keeps this within Kite's historical-data
 * limit regardless of how many exchange/interval combinations pile up
 * together.
 */
async function processDailyEodSync() {
    const result = await db.query(`SELECT exchange, symbol FROM companies ORDER BY exchange ASC, symbol ASC`);

    for (const row of result.rows) {
        await enqueueSymbolSync(row.symbol, "day", row.exchange);
        await enqueueSymbolSync(row.symbol, "minute", row.exchange);
    }

    console.log(`[daily-eod-sync] enqueued ${result.rows.length} symbols (day + minute)`);
    return { enqueued: result.rows.length };
}

module.exports = { processDailyEodSync };
