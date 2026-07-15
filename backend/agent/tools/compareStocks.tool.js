const { getCandlesForYears } = require("../lib/marketData");

module.exports = {
    name: "compare_stocks",
    description: "Compare price performance of two or more stocks over the same period. Use this for questions like 'compare TCS and Infosys'.",
    parameters: {
        type: "object",
        properties: {
            symbols: {
                type: "array",
                items: { type: "string" },
                description: "NSE trading symbols to compare, e.g. [\"TCS\", \"INFY\"]",
            },
            years: { type: "number", description: "Number of years to compare over (default 1)" },
        },
        required: ["symbols"],
    },
    async execute({ symbols, years = 1 }) {
        const results = await Promise.all(
            symbols.map(async (symbol) => {
                const candles = await getCandlesForYears(symbol, years);
                if (candles.length === 0) {
                    return { symbol: symbol.toUpperCase(), error: "No stored historical data" };
                }

                const closes = candles.map((candle) => Number(candle.close));
                const percentChange = Number((((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2));
                return { symbol: symbol.toUpperCase(), latestClose: closes[closes.length - 1], percentChange };
            })
        );

        const valid = results.filter((result) => !result.error);
        const bestPerformer = valid.length > 0
            ? valid.reduce((best, current) => (current.percentChange > best.percentChange ? current : best))
            : null;

        return { comparison: results, bestPerformer: bestPerformer?.symbol ?? null };
    },
};
