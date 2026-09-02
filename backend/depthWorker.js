const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "..", ".env"),
    override: true,
});

const { Worker } = require("bullmq");
const connection = require("./config/queueConnection");
const { processPostgresBackup } = require("./jobs/postgresBackup.job");
const liveTicker = require("./services/liveTicker.service");

const depthSchedulerWorker = new Worker(
    "depth-scheduler",
    async (job) => {
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
    // depth-snapshot (the Postgres-persistence job) has been removed --
    // depth_snapshots is no longer stored (unused by the ML pipeline, see
    // migration 017). depth-scheduler queue/worker stays alive purely
    // because this process is still needed for liveTicker below.
    //
    // postgres-backup is intentionally NOT scheduled here right now -- the
    // backup target (external drive) now hosts the live database itself
    // (see /mnt/stockdata), so backing up to the same physical disk isn't
    // real protection. Re-enable once backups point somewhere separate
    // (e.g. the internal disk) -- processPostgresBackup() and its job file
    // are still intact, just not wired into the schedule for now.

    console.log("No recurring schedules registered on depth-scheduler (depth-snapshot removed, postgres-backup currently disabled).");
}

registerSchedules().catch((err) => {
    console.error("Failed to register schedules:", err.message);
    process.exit(1);
});

liveTicker.start();

// Permanent, always-on subscription for every tracked company -- powers the
// live quote/depth feed (Redis-backed, streamed over socket.io) independent
// of whatever's actually visible on someone's Dashboard right now. This is
// the reason this process still needs to run even with depth persistence
// removed.
liveTicker.subscribeAllTracked().catch((err) => {
    console.error("[live-ticker] subscribeAllTracked failed:", err.message);
});

console.log("Depth worker process started (queue: depth-scheduler idle; live ticker active)");
