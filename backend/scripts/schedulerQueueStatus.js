const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { historicalSchedulerQueue } = require("../queues");

const STATES = ["waiting", "active", "delayed", "completed", "failed"];
const LIST_LIMIT = Number(process.argv[2]) || 20;

// Same idea as queueStatus.js but for the historical-scheduler queue --
// covers instrument-master-refresh, daily-eod-sync, and daily-movers-snapshot,
// which queueStatus.js (historical-sync only) doesn't show.
async function main() {
    const counts = await historicalSchedulerQueue.getJobCounts(...STATES);
    console.log("Job counts:", counts);

    for (const state of STATES) {
        const jobs = await historicalSchedulerQueue.getJobs([state], 0, LIST_LIMIT - 1);
        if (jobs.length === 0) continue;

        console.log(`\n-- ${state} (showing up to ${LIST_LIMIT}) --`);
        for (const job of jobs) {
            const detail = state === "failed" ? ` -- ${job.failedReason}` : "";
            console.log(`${job.id} (${job.name}, data=${JSON.stringify(job.data)})${detail}`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
