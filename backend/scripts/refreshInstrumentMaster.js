const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { historicalSchedulerQueue } = require("../queues");

const exchange = (process.argv[2] || "NSE").toUpperCase();

// One-off trigger for the same instrument-master-refresh job that normally
// only fires Sunday 3 AM IST (see historicalWorker.js) -- for when stale
// instrument_token values in `companies` are causing "invalid token" sync
// failures and you want fresh tokens from Kite immediately instead of
// waiting for the schedule. Only *enqueues* the job; a historicalWorker.js
// process must already be running to actually process it.
(async () => {
    const job = await historicalSchedulerQueue.add("instrument-master-refresh", { exchange });
    console.log(`[refresh-instrument-master] enqueued job ${job.id} for ${exchange}. Make sure historicalWorker.js is running to process it.`);
    process.exit(0);
})().catch((err) => {
    console.error("[refresh-instrument-master] failed:", err.message);
    process.exit(1);
});
