const { getCandlesForYears } = require("../lib/marketData");

module.exports = {
    name: "get_historical_data",
    description:
        "Fetch a summary of a stock's historical price performance over N years: start/end price, percent change, and high/low closes. Use this for questions like 'analyze the last 2 years of Reliance'.",
    parameters: {
        type: "object",
        properties: {
            symbol: { type: "string", description: "NSE trading symbol, e.g. RELIANCE" },
            years: { type: "number", description: "Number of years of history to analyze (default 2)" },
        },
        required: ["symbol"],
    },
    async execute({ symbol, years = 2 }) {
        const candles = await getCandlesForYears(symbol, years);
        if (candles.length === 0) {
            return { symbol: symbol.toUpperCase(), error: "No stored historical data. It may need to be synced first." };
        }

        const closes = candles.map((candle) => Number(candle.close));
        const startClose = closes[0];
        const endClose = closes[closes.length - 1];

        return {
            symbol: symbol.toUpperCase(),
            from: candles[0].date,
            to: candles[candles.length - 1].date,
            candleCount: candles.length,
            startClose,
            endClose,
            percentChange: Number((((endClose - startClose) / startClose) * 100).toFixed(2)),
            highestClose: Math.max(...closes),
            lowestClose: Math.min(...closes),
        };
    },
};
