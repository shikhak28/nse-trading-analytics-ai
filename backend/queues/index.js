const { Queue } = require("bullmq");
const connection = require("../config/queueConnection");

const defaultJobOptions = {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
};

const historicalSyncQueue = new Queue("historical-sync", { connection, defaultJobOptions });
// Split from a single "scheduler" queue so the historical-data process and
// the depth-capture process can each run standalone, listening only to the
// scheduled jobs relevant to them, instead of competing for jobs off one
// shared queue and throwing on job types meant for the other process.
const historicalSchedulerQueue = new Queue("historical-scheduler", { connection, defaultJobOptions });
const depthSchedulerQueue = new Queue("depth-scheduler", { connection, defaultJobOptions });

/**
 * Queue a resumable per-symbol historical sync. jobId dedups so re-triggering
 * a sync that's already queued/running for the same exchange+symbol+interval
 * is a no-op instead of piling up duplicate work. exchange is folded into the
 * middle segment (hyphen-joined, not its own colon segment) so an NSE and BSE
 * sync for the same symbol (dually-listed stocks share tradingsymbols across
 * exchanges) don't collide -- BullMQ's custom-jobId validation only allows
 * colon-containing ids when they split into exactly 3 parts (a backwards-compat
 * rule for old repeatable-job ids), so a 4-segment id throws "Custom Id cannot
 * contain :".
 */
async function enqueueSymbolSync(symbol, interval = "day", exchange = "NSE") {
    return historicalSyncQueue.add(
        "sync-symbol",
        { symbol: symbol.toUpperCase(), interval, exchange: exchange.toUpperCase() },
        { jobId: `sync:${exchange.toUpperCase()}-${symbol.toUpperCase()}:${interval}` }
    );
}

module.exports = {
    historicalSyncQueue,
    historicalSchedulerQueue,
    depthSchedulerQueue,
    enqueueSymbolSync,
};
