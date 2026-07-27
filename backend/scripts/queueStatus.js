const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { historicalSyncQueue } = require("../queues");

const STATES = ["waiting", "active", "delayed", "completed", "failed"];
const LIST_LIMIT = Number(process.argv[2]) || 20;

/**
 * Overview of the historical-sync queue -- counts per state plus the most
 * recent jobs in each, so you can see what's stuck waiting, currently
 * running, or failed without knowing a specific symbol to look up (see
 * checkSyncStatus.js for that).
 */
async function main() {
    const counts = await historicalSyncQueue.getJobCounts(...STATES);
    console.log("Job counts:", counts);

    for (const state of STATES) {
        const jobs = await historicalSyncQueue.getJobs([state], 0, LIST_LIMIT - 1);
        if (jobs.length === 0) continue;

        console.log(`\n-- ${state} (showing up to ${LIST_LIMIT}) --`);
        for (const job of jobs) {
            const { symbol, interval, exchange } = job.data;
            const detail = state === "failed" ? ` -- ${job.failedReason}` : "";
            console.log(`${job.id} (${exchange}:${symbol}, ${interval})${detail}`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
