const { historicalSyncQueue, historicalSchedulerQueue } = require("../queues");

(async () => {
    await historicalSyncQueue.obliterate({ force: true });
    await historicalSchedulerQueue.obliterate({ force: true });

    console.log("All BullMQ jobs deleted");
    process.exit(0);
})();
