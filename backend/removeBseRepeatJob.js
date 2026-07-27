const { historicalSchedulerQueue } = require("./queues");

(async () => {
    const repeatJobs = await historicalSchedulerQueue.getRepeatableJobs();

    for (const job of repeatJobs) {
        if (
            job.name === "instrument-master-refresh" &&
            job.pattern === "0 15 3 * * 0"
        ) {
            await historicalSchedulerQueue.removeRepeatableByKey(job.key);
            console.log("Removed:", job);
        }
    }

    process.exit(0);
})();
