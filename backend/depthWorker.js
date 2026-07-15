const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    override: true,
});

const { Worker } = require("bullmq");
const connection = require("./config/queueConnection");
const { depthSchedulerQueue } = require("./queues");
const { processDepthSnapshot } = require("./jobs/depthSnapshot.job");
const { processPostgresBackup } = require("./jobs/postgresBackup.job");
const liveTicker = require("./services/liveTicker.service");

const depthSchedulerWorker = new Worker(
    "depth-scheduler",
    async (job) => {
        if (job.name === "depth-snapshot") {
            return processDepthSnapshot();
        }
        if (job.name === "postgres-backup") {
            return processPostgresBackup();
        }
        throw new Error(`Unknown depth-scheduler job: ${job.name}`);
    },
    { connection, concurrency: 1 }
);

depthSchedulerWorker.on("completed", (job) => {
    console.log(`[${job.queueName}] completed: ${job.name} (${job.id})`);
});

depthSchedulerWorker.on("failed", (job, err) => {
    console.error(`[${job?.queueName}] failed: ${job?.name} (${job?.id})`, err.message);
});

async function registerSchedules() {
    // Every minute, but only actually does anything 9:15-15:30 IST weekdays
    // (processDepthSnapshot self-checks and no-ops outside that window --
    // simpler and more precise than fighting cron's minute-range syntax to
    // encode an exact HH:MM boundary). Firing across the broader 9-15 hour
    // block just gives the job a chance to run and self-skip the edges.
    await depthSchedulerQueue.add(
        "depth-snapshot",
        {},
        { repeat: { pattern: "* 9-15 * * 1-5", tz: "Asia/Kolkata" }, jobId: "depth-snapshot" }
    );

    // postgres-backup is intentionally NOT scheduled here right now -- the
    // backup target (external drive) now hosts the live database itself
    // (see /mnt/stockdata), so backing up to the same physical disk isn't
    // real protection. Re-enable once backups point somewhere separate
    // (e.g. the internal disk) -- processPostgresBackup() and its job file
    // are still intact, just not wired into the schedule for now.

    console.log("Registered recurring schedules: depth-snapshot (market hours only). postgres-backup is currently disabled.");
}

registerSchedules().catch((err) => {
    console.error("Failed to register schedules:", err.message);
    process.exit(1);
});

liveTicker.start();

// Permanent, always-on subscription for every tracked company -- needed so
// depth-snapshot has something to read every minute, independent of
// whatever's actually visible on someone's Dashboard right now.
liveTicker.subscribeAllTracked().catch((err) => {
    console.error("[live-ticker] subscribeAllTracked failed:", err.message);
});

console.log("Depth worker process started (queue: depth-scheduler; live ticker active)");
