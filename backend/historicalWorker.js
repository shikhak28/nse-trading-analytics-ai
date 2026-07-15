const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    override: true,
});

const { Worker } = require("bullmq");
const connection = require("./config/queueConnection");
const { historicalSchedulerQueue } = require("./queues");
const { processHistoricalSync } = require("./jobs/historicalSync.job");
const { processDailyEodSync } = require("./jobs/dailyEodSync.job");
const { processInstrumentMasterRefresh } = require("./jobs/instrumentMasterRefresh.job");

// Kite's historical-data endpoint has a low rate limit; keep this
// conservative regardless of how many symbols are queued at once.
const historicalSyncWorker = new Worker("historical-sync", processHistoricalSync, {
    connection,
    concurrency: 2,
    limiter: { max: 3, duration: 1000 },
});

const historicalSchedulerWorker = new Worker(
    "historical-scheduler",
    async (job) => {
        if (job.name === "daily-eod-sync") {
            return processDailyEodSync();
        }
        if (job.name === "instrument-master-refresh") {
            return processInstrumentMasterRefresh(job);
        }
        throw new Error(`Unknown historical-scheduler job: ${job.name}`);
    },
    { connection, concurrency: 1 }
);

for (const worker of [historicalSyncWorker, historicalSchedulerWorker]) {
    worker.on("completed", (job) => {
        console.log(`[${job.queueName}] completed: ${job.name} (${job.id})`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[${job?.queueName}] failed: ${job?.name} (${job?.id})`, err.message);
    });
}

async function registerSchedules() {
    // 4:30 PM IST, weekdays -- an hour after NSE close, giving Kite's EOD
    // data time to settle.
    await historicalSchedulerQueue.add(
        "daily-eod-sync",
        {},
        { repeat: { pattern: "0 30 16 * * 1-5", tz: "Asia/Kolkata" }, jobId: "daily-eod-sync" }
    );

    // Sunday 3 AM IST -- low-traffic time to refresh the instrument master,
    // for each exchange tracked.
    await historicalSchedulerQueue.add(
        "instrument-master-refresh",
        { exchange: "NSE" },
        { repeat: { pattern: "0 0 3 * * 0", tz: "Asia/Kolkata" }, jobId: "instrument-master-refresh-nse" }
    );
    await historicalSchedulerQueue.add(
        "instrument-master-refresh",
        { exchange: "BSE" },
        { repeat: { pattern: "0 15 3 * * 0", tz: "Asia/Kolkata" }, jobId: "instrument-master-refresh-bse" }
    );

    console.log("Registered recurring schedules: daily-eod-sync, instrument-master-refresh (NSE+BSE).");
}

registerSchedules().catch((err) => {
    console.error("Failed to register schedules:", err.message);
    process.exit(1);
});

console.log("Historical worker process started (queues: historical-sync, historical-scheduler)");
