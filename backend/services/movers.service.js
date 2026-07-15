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

    const companies = await marketService.getCompanies({ exchange, limit: 10000 });
    if (companies.length === 0) {
        return [];
    }

    const pipeline = redis.pipeline();
    for (const company of companies) {
        pipeline.hmget(`quote:${company.symbol}`, "ltp", "change_percent", "volume", "total_buy_quantity", "total_sell_quantity");
    }
    const results = await pipeline.exec();

    const merged = companies.map((company, index) => {
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

    return merged
        .filter((row) => row[metric.field] != null)
        .sort((a, b) => (metric.direction === "desc" ? b[metric.field] - a[metric.field] : a[metric.field] - b[metric.field]))
        .slice(0, limit);
}

module.exports = { getTopMovers, METRICS: Object.keys(METRICS) };
