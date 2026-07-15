const { getCandlesForYears, getTrackedSymbols } = require("../lib/marketData");
const { isVolumeIncreasing } = require("../indicators/technicalIndicators");

module.exports = {
    name: "scan_increasing_volume",
    description:
        "Scan tracked stocks for ones whose trading volume has been trending up over the last N days versus the N days before. Use this for questions like 'find stocks with increasing volume for the last 10 days'.",
    parameters: {
        type: "object",
        properties: {
            days: { type: "number", description: "Window size in days, default 10" },
            limit: { type: "number", description: "Max matches to return, default 20" },
        },
    },
    async execute({ days = 10, limit = 20 } = {}) {
        const symbols = await getTrackedSymbols();
        const matches = [];

        for (const symbol of symbols) {
            const candles = await getCandlesForYears(symbol, 1);
            if (isVolumeIncreasing(candles, days)) {
                matches.push({ symbol });
                if (matches.length >= limit) break;
            }
        }

        return { days, matchCount: matches.length, matches };
    },
};
