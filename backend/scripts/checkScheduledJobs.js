const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const { historicalSchedulerQueue } = require("../queues");

// Reports the actual run history of the repeatable jobs registered in
// historicalWorker.js's registerSchedules() (daily-eod-sync, 4:30 PM IST
// weekdays; instrument-master-refresh, Sunday 3 AM IST; daily-movers-snapshot,
// 7 AM IST daily) -- so you can tell whether today's scheduled fire actually
// ran, vs. having been triggered manually (syncToday.js etc, which use the
// same underlying processDailyEodSync() but don't show up here since they
// don't go through this queue's repeatable-job mechanism).
const JOB_NAMES = ["daily-eod-sync", "instrument-master-refresh", "daily-movers-snapshot"];

(async () => {
    for (const name of JOB_NAMES) {
        const completed = await historicalSchedulerQueue.getJobs(["completed"], 0, 20);
        const failed = await historicalSchedulerQueue.getJobs(["failed"], 0, 20);

        const recent = [...completed, ...failed]
            .filter((j) => j.name === name)
            .sort((a, b) => (b.finishedOn || 0) - (a.finishedOn || 0));

        console.log(`\n=== ${name} ===`);
        if (recent.length === 0) {
            console.log("No completed/failed runs found (BullMQ prunes old ones -- see removeOnComplete/removeOnFail in queues/index.js).");
            continue;
        }

        for (const job of recent.slice(0, 5)) {
            const finishedAt = job.finishedOn ? new Date(job.finishedOn).toISOString() : "n/a";
            const state = await job.getState();
            if (state === "failed") {
                console.log(`  ${finishedAt} -- FAILED: ${job.failedReason}`);
            } else {
                console.log(`  ${finishedAt} -- completed, result: ${JSON.stringify(job.returnvalue)}`);
            }
        }
    }

    const repeatables = await historicalSchedulerQueue.getJobSchedulers();
    console.log("\nRegistered schedules (next scheduled run time):");
    for (const r of repeatables) {
        console.log(`  ${r.name}: next=${r.next ? new Date(r.next).toISOString() : "n/a"} pattern=${r.pattern}`);
    }

    process.exit(0);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
