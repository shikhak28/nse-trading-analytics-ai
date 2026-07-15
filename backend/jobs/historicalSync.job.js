const authService = require("../services/auth.service");
const marketService = require("../services/market.service");
const syncService = require("../services/sync.service");

const BACKFILL_YEARS = 3;

/**
 * Resumable per-symbol historical sync. Backfills 3 years on first run,
 * then only fetches the delta since the last stored candle -- safe to
 * re-run (upserts dedup) and cheap once a symbol is caught up.
 */
async function processHistoricalSync(job) {
    const { symbol, interval = "day", exchange = "NSE" } = job.data;

    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.log(`[historical-sync] skipped ${exchange}:${symbol}: not authenticated with Zerodha`);
        return { skipped: true, reason: "not_authenticated" };
    }

    const [company] = await marketService.getCompaniesBySymbols([symbol], exchange);
    if (!company?.instrument_token) {
        console.log(`[historical-sync] skipped ${exchange}:${symbol}: no instrument_token in companies table`);
        return { skipped: true, reason: "unknown_instrument" };
    }

    const lastCandle = await marketService.getLastCandleTimestamp(symbol, interval, exchange);
    const now = new Date();
    // Daily candles resume a full day later; intraday candles resume one
    // minute later -- adding a full day here for "minute" would jump past
    // the rest of the last stored trading session (e.g. last candle at
    // 15:29 -> next-day 15:29, skipping that whole morning).
    const resumeStepMs = interval === "day" ? 86400000 : 60000;
    const from = lastCandle
        ? new Date(lastCandle.getTime() + resumeStepMs)
        : new Date(now.getFullYear() - BACKFILL_YEARS, now.getMonth(), now.getDate());

    if (from >= now) {
        return { skipped: true, reason: "already_up_to_date" };
    }

    const candleCount = await syncService.syncSymbolRange(symbol, company.instrument_token, interval, from, now, exchange);
    console.log(`[historical-sync] ${exchange}:${symbol} (${interval}): ${candleCount} candles synced`);

    return { symbol, exchange, interval, candles: candleCount };
}

module.exports = { processHistoricalSync };
