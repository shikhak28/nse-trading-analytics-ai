const redis = require("../config/redis");
const marketService = require("./market.service");

// Same live quote fields liveTicker.service.js caches per symbol
// (quote:{symbol} hash) -- these filters read that cache directly rather
// than hitting Kite again, since subscribeAllTracked() already keeps it
// populated for every tracked company continuously during market hours.
const METRICS = {
    gainers: { field: "change_percent", direction: "desc" },
    losers: { field: "change_percent", direction: "asc" },
    volume: { field: "volume", direction: "desc" },
    top_bid: { field: "total_buy_quantity", direction: "desc" },
    top_sell: { field: "total_sell_quantity", direction: "desc" },
};

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "null" || value === "") {
        return null;
    }
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
}

/**
 * Fetches every tracked company merged with its live Redis quote fields.
 * Shared by getTopMovers (ranks by one metric) and getByChangeRange (filters
 * by a change_percent window) so the company-list + Redis-pipeline lookup
 * isn't duplicated between them.
 */
async function getAllWithQuotes(exchange) {
    const companies = await marketService.getCompanies({ exchange, limit: 10000 });
    if (companies.length === 0) {
        return [];
    }

    const pipeline = redis.pipeline();
    for (const company of companies) {
        pipeline.hmget(`quote:${company.symbol}`, "ltp", "change_percent", "volume", "total_buy_quantity", "total_sell_quantity");
    }
    const results = await pipeline.exec();

    return companies.map((company, index) => {
        const [ltp, changePercent, volume, totalBuyQuantity, totalSellQuantity] = results[index][1] || [];
        return {
            symbol: company.symbol,
            company_name: company.company_name,
            exchange: company.exchange,
            ltp: toNumberOrNull(ltp),
            change_percent: toNumberOrNull(changePercent),
            volume: toNumberOrNull(volume),
            total_buy_quantity: toNumberOrNull(totalBuyQuantity),
            total_sell_quantity: toNumberOrNull(totalSellQuantity),
        };
    });
}

/**
 * Ranks tracked companies by a live-quote metric (gainers/losers/volume/
 * top_bid/top_sell). Companies with no cached quote yet (outside market
 * hours, or newly added and not yet ticked) are excluded rather than sorted
 * in as zeros -- "top volume" showing untraded symbols first would be wrong.
 */
async function getTopMovers({ type, exchange, limit = 20 }) {
    const metric = METRICS[type];
    if (!metric) {
        throw new Error(`Unknown movers type: ${type}. Expected one of ${Object.keys(METRICS).join(", ")}`);
    }

    const merged = await getAllWithQuotes(exchange);

    return merged
        .filter((row) => row[metric.field] != null)
        .sort((a, b) => (metric.direction === "desc" ? b[metric.field] - a[metric.field] : a[metric.field] - b[metric.field]))
        .slice(0, limit);
}

/**
 * Screens tracked companies for today's live change_percent falling within
 * [min, max] -- e.g. "companies up 3-5% today". Same excluded-if-no-quote
 * rule as getTopMovers.
 */
async function getByChangeRange({ min, max, exchange, limit = 50 }) {
    if (typeof min !== "number" || typeof max !== "number" || Number.isNaN(min) || Number.isNaN(max)) {
        throw new Error("min and max must be numbers");
    }

    const merged = await getAllWithQuotes(exchange);

    return merged
        .filter((row) => row.change_percent != null && row.change_percent >= min && row.change_percent <= max)
        .sort((a, b) => b.change_percent - a.change_percent)
        .slice(0, limit);
}

module.exports = { getTopMovers, getByChangeRange, METRICS: Object.keys(METRICS) };
