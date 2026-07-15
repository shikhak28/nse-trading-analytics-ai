const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");
const { historicalSyncQueue } = require("../queues");

(async () => {
    const counts = await historicalSyncQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
    console.log("Queue:", counts);

    const companies = await db.query("SELECT exchange, count(*) FROM companies GROUP BY exchange");
    console.log("Companies:", companies.rows);

    const rows = await db.query("SELECT exchange, interval, count(*) FROM historical_prices GROUP BY exchange, interval ORDER BY exchange, interval");
    console.log("Historical rows:", rows.rows);

    const dbSize = await db.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
    console.log("DB size:", dbSize.rows[0].size);

    const failed = await historicalSyncQueue.getJobs(["failed"], 0, 5);
    if (failed.length) console.log("Sample failures:", failed.map(j => `${j.id}: ${j.failedReason}`));

    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
