const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");
const { isWithinMarketHours } = require("../jobs/depthSnapshot.job");

(async () => {
    const now = new Date();
    console.log("Within NSE market hours right now:", isWithinMarketHours(now));

    const total = await db.query("SELECT count(*) FROM depth_snapshots");
    console.log("Total depth_snapshots rows:", total.rows[0].count);

    const latestTimestamp = await db.query("SELECT max(snapshot_timestamp) AS latest FROM depth_snapshots");
    const latest = latestTimestamp.rows[0].latest;
    console.log("Most recent snapshot:", latest ? latest.toISOString() : "none yet");
    if (latest) {
        const ageSeconds = Math.round((now - latest) / 1000);
        console.log("Age of most recent snapshot:", ageSeconds, "seconds", ageSeconds > 120 ? "(stale -- expected ~60s during market hours)" : "(fresh)");
    }

    const coverage = await db.query(`
        SELECT count(DISTINCT symbol) AS symbols_with_depth
        FROM depth_snapshots
        WHERE snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM depth_snapshots)
    `);
    console.log("Symbols captured in the most recent minute:", coverage.rows[0].symbols_with_depth, "/ 2712 tracked");

    const sample = await db.query(`
        SELECT symbol, snapshot_timestamp, ltp, buy1_price, buy1_qty, sell1_price, sell1_qty
        FROM depth_snapshots
        WHERE snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM depth_snapshots)
        ORDER BY symbol
        LIMIT 5
    `);
    console.log("Sample rows from the latest snapshot:", sample.rows);

    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
