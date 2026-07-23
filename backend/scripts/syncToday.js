const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { processDailyEodSync } = require("../jobs/dailyEodSync.job");

// One-off trigger for the same day+minute catch-up sync that daily-eod-sync
// normally only fires at 4:30 PM IST (see historicalWorker.js) -- for when
// you want today's data pulled immediately instead of waiting for that
// schedule. Only *enqueues* the jobs (same as the scheduled version); a
// historicalWorker.js process must already be running to actually process
// the queue and fetch from Kite. Safe to re-run -- historicalSync.job.js
// resumes each symbol from its last stored candle, so nothing is re-fetched.
(async () => {
    const result = await processDailyEodSync();
    console.log(`[sync-today] enqueued ${result.enqueued} companies (day + minute). Make sure historicalWorker.js is running to process the queue.`);
    process.exit(0);
})().catch((err) => {
    console.error("[sync-today] failed:", err.message);
    process.exit(1);
});
