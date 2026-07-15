const { getCandlesForYears, getTrackedSymbols } = require("../lib/marketData");
const { detectBreakout } = require("../indicators/technicalIndicators");

module.exports = {
    name: "find_breakouts",
    description:
        "Scan tracked stocks for breakout candidates -- price closing above its N-day high on well-above-average volume. Use this for questions like 'show breakout candidates'.",
    parameters: {
        type: "object",
        properties: {
            lookbackDays: { type: "number", description: "N-day high window, default 20" },
            limit: { type: "number", description: "Max matches to return, default 20" },
        },
    },
    async execute({ lookbackDays = 20, limit = 20 } = {}) {
        const symbols = await getTrackedSymbols();
        const matches = [];

        for (const symbol of symbols) {
            const candles = await getCandlesForYears(symbol, 1);
            const result = detectBreakout(candles, lookbackDays);
            if (result.isBreakout) {
                matches.push({ symbol, ...result });
                if (matches.length >= limit) break;
            }
        }

        return { lookbackDays, matchCount: matches.length, matches };
    },
};
