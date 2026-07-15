const marketService = require("../../services/market.service");

async function getCandlesForYears(symbol, years) {
    const from = new Date();
    from.setFullYear(from.getFullYear() - years);
    return marketService.getStoredHistoricalPrices(symbol.toUpperCase(), "day", from.toISOString(), new Date().toISOString());
}

/**
 * Symbols that actually have stored daily history -- i.e. the tracked set
 * that's actually screenable, not all 2000+ companies (most of which have
 * never been synced).
 */
async function getTrackedSymbols(limit = 200) {
    const summaries = await marketService.getStoredHistoricalSummary(limit);
    return [...new Set(summaries.filter((summary) => summary.interval === "day").map((summary) => summary.symbol))];
}

module.exports = { getCandlesForYears, getTrackedSymbols };
