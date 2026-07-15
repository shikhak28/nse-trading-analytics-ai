const kite = require("../config/kite");
const marketService = require("./market.service");

const DAY_CHUNK_SIZE_DAYS = 365;
const INTRADAY_CHUNK_SIZE_DAYS = 60;
const CHUNK_DELAY_MS = 350; // stay comfortably under Kite's historical-data rate limit

function formatKiteDate(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kite's historical-data endpoint has a max date-range per request that
 * depends on candle interval (generous for daily candles, much tighter for
 * intraday). Split any request into interval-appropriate windows.
 */
function chunkDateRange(from, to, interval) {
    const chunkDays = interval === "day" ? DAY_CHUNK_SIZE_DAYS : INTRADAY_CHUNK_SIZE_DAYS;
    const chunkMs = chunkDays * 86400000;
    const end = new Date(to);
    const chunks = [];
    let cursor = new Date(from);

    while (cursor < end) {
        const chunkEnd = new Date(Math.min(cursor.getTime() + chunkMs, end.getTime()));
        chunks.push({ from: cursor, to: chunkEnd });
        cursor = new Date(chunkEnd.getTime() + 1000);
    }

    return chunks;
}

/**
 * Fetch candles for a symbol/date-range from Kite and persist them,
 * chunking as needed. Assumes the caller has already ensured the Kite
 * client has a valid access token set.
 */
async function syncSymbolRange(symbol, instrumentToken, interval, from, to, exchange = "NSE") {
    const chunks = chunkDateRange(from, to, interval);
    let totalCandles = 0;

    for (const chunk of chunks) {
        const candles = await kite.getHistoricalData(
            instrumentToken,
            interval,
            formatKiteDate(chunk.from),
            formatKiteDate(chunk.to)
        );

        if (Array.isArray(candles) && candles.length > 0) {
            await marketService.saveHistoricalPrices(symbol, interval, candles, instrumentToken, exchange);
            totalCandles += candles.length;
        }

        if (chunks.length > 1) {
            await sleep(CHUNK_DELAY_MS);
        }
    }

    return totalCandles;
}

module.exports = {
    syncSymbolRange,
    chunkDateRange,
};
