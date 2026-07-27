const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const kite = require("../config/kite");
const authService = require("../services/auth.service");
const db = require("../config/db");
const { historicalSyncQueue } = require("../queues");

// Re-running syncToday.js/backfillMissingSymbols.js does NOT retry a job
// that's already in the `failed` state -- BullMQ's custom jobId dedup means
// re-adding the same jobId is a silent no-op once it exists in any state.
// This script instead: (1) reads every currently-failed job, (2) for each
// symbol, checks whether its stored instrument_token in `companies` matches
// Kite's *current* dump and fixes it if not, then (3) calls job.retry() --
// the actual BullMQ-supported way to move a failed job back to `waiting`.
async function main() {
    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.error("Not authenticated with Zerodha -- run /auth/login first.");
        process.exit(1);
    }

    const failedJobs = await historicalSyncQueue.getJobs(["failed"], 0, -1);
    if (failedJobs.length === 0) {
        console.log("No failed jobs.");
        process.exit(0);
    }
    console.log(`Found ${failedJobs.length} failed jobs.`);

    const exchanges = [...new Set(failedJobs.map((j) => j.data.exchange))];
    const dumpByExchange = {};
    for (const exchange of exchanges) {
        console.log(`Fetching current Kite instrument dump for ${exchange}...`);
        const instruments = await kite.getInstruments(exchange);
        dumpByExchange[exchange] = new Map(instruments.map((i) => [i.tradingsymbol.toUpperCase(), i]));
    }

    const uniqueSymbols = new Map(); // "EXCHANGE:SYMBOL" -> {exchange, symbol}
    for (const job of failedJobs) {
        const { exchange, symbol } = job.data;
        uniqueSymbols.set(`${exchange}:${symbol}`, { exchange, symbol });
    }

    const notFound = [];
    const fixed = [];
    const alreadyOk = [];

    for (const { exchange, symbol } of uniqueSymbols.values()) {
        const kiteMatch = dumpByExchange[exchange].get(symbol);
        if (!kiteMatch) {
            notFound.push(`${exchange}:${symbol}`);
            continue;
        }

        const { rows } = await db.query(
            `SELECT instrument_token FROM companies WHERE exchange = $1 AND symbol = $2`,
            [exchange, symbol]
        );
        const dbToken = rows[0]?.instrument_token;

        if (String(dbToken) !== String(kiteMatch.instrument_token)) {
            await db.query(
                `UPDATE companies SET instrument_token = $1, updated_at = NOW() WHERE exchange = $2 AND symbol = $3`,
                [kiteMatch.instrument_token, exchange, symbol]
            );
            fixed.push(`${exchange}:${symbol} (${dbToken} -> ${kiteMatch.instrument_token})`);
        } else {
            alreadyOk.push(`${exchange}:${symbol}`);
        }
    }

    console.log(`\nFixed instrument_token for ${fixed.length} symbols:`);
    fixed.forEach((s) => console.log(`  ${s}`));

    console.log(`\nNOT FOUND in current Kite dump (likely delisted/renamed) -- ${notFound.length} symbols, will NOT retry:`);
    notFound.forEach((s) => console.log(`  ${s}`));

    console.log(`\nToken already correct (failure was something else) -- ${alreadyOk.length} symbols:`);
    alreadyOk.forEach((s) => console.log(`  ${s}`));

    const skipSet = new Set(notFound);
    let retried = 0;
    for (const job of failedJobs) {
        const key = `${job.data.exchange}:${job.data.symbol}`;
        if (skipSet.has(key)) continue;
        await job.retry();
        retried++;
    }

    console.log(`\nRetried ${retried} jobs. Make sure historicalWorker.js is running to process them.`);
    process.exit(0);
}

main().catch((err) => {
    console.error("[fix-failed-sync] failed:", err);
    process.exit(1);
});
