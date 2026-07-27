const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { historicalSyncQueue } = require("../queues");
const marketService = require("../services/market.service");

const symbol = (process.argv[2] || "").trim().toUpperCase();
const interval = process.argv[3] || "minute";
const exchange = (process.argv[4] || "NSE").toUpperCase();

if (!symbol) {
    console.error("Usage: node scripts/checkSyncStatus.js <SYMBOL> [interval=minute] [exchange=NSE]");
    process.exit(1);
}

/**
 * Looks up a single symbol's historical-sync job directly by the same jobId
 * enqueueSymbolSync uses (see queues/index.js), so it finds the exact job a
 * /market/historical/sync call created -- no need to tail historicalWorker.js's
 * logs. Also reports the actual stored candle count as a sanity check, since
 * a "completed" job with 0 new candles (already up to date) looks different
 * from one that's simply still queued.
 */
async function main() {
    const jobId = `sync:${exchange}-${symbol}:${interval}`;
    const job = await historicalSyncQueue.getJob(jobId);

    if (!job) {
        console.log(`No job found for ${exchange}:${symbol} (${interval}) -- either never queued, or already cleared (BullMQ drops old completed/failed jobs).`);
    } else {
        const state = await job.getState();
        console.log(`Job ${jobId}: ${state}`);
        if (state === "completed") {
            console.log("Result:", job.returnvalue);
        } else if (state === "failed") {
            console.log("Failure reason:", job.failedReason);
        }
    }

    const candles = await marketService.getStoredHistoricalPrices(symbol, interval, undefined, undefined, exchange);
    console.log(`Stored ${interval} candles for ${exchange}:${symbol}: ${candles.length}`);
    if (candles.length > 0) {
        console.log("Most recent candle:", candles[candles.length - 1]);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
