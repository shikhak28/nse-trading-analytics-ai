const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const authService = require("../services/auth.service");
const marketService = require("../services/market.service");
const syncService = require("../services/sync.service");

// Bypasses the queue entirely -- syncs one symbol's day candles right now,
// synchronously, so you can confirm the actual Kite fetch + DB write works
// without waiting behind thousands of already-queued jobs.
// Usage: node scripts/syncOneSymbolNow.js RELIANCE day NSE
const symbol = (process.argv[2] || "").toUpperCase();
const interval = process.argv[3] || "day";
const exchange = (process.argv[4] || "NSE").toUpperCase();

(async () => {
    if (!symbol) {
        console.error("Usage: node scripts/syncOneSymbolNow.js <SYMBOL> [interval=day] [exchange=NSE]");
        process.exit(1);
    }

    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.error("Not authenticated with Zerodha -- log in via the app first.");
        process.exit(1);
    }

    const [company] = await marketService.getCompaniesBySymbols([symbol], exchange);
    if (!company?.instrument_token) {
        console.error(`No instrument_token found for ${exchange}:${symbol} -- check spelling / that instrument-master-refresh has run.`);
        process.exit(1);
    }

    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);

    console.log(`Syncing ${exchange}:${symbol} (${interval}) from ${from.toISOString()} to ${to.toISOString()}...`);
    const count = await syncService.syncSymbolRange(symbol, company.instrument_token, interval, from, to, exchange);
    console.log(`Done: ${count} candles synced for ${exchange}:${symbol}.`);
    process.exit(0);
})().catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
});
