const dailyMoversService = require("../services/dailyMovers.service");

/**
 * Computes and stores yesterday's top gainers/losers/volume/bid/sell
 * leaderboards. Runs the morning after (not right after EOD sync) because
 * dailyEodSync.job.js only *enqueues* that day's candle sync -- the actual
 * Kite fetch is rate-limited (3 req/sec) and can take a while to drain for
 * thousands of symbols, so "yesterday" is the newest date guaranteed to be
 * fully synced by the time this runs (see historicalWorker.js schedule).
 */
async function processDailyMoversSnapshot() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);

    const counts = await dailyMoversService.computeAndStoreDailyMovers(date);
    console.log(`[daily-movers-snapshot] stored snapshot for ${date}:`, counts);
    return { date, counts };
}

module.exports = { processDailyMoversSnapshot };
