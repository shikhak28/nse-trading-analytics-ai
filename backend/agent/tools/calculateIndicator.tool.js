const { getCandlesForYears } = require("../lib/marketData");
const { calculateRSI, calculateSMA } = require("../indicators/technicalIndicators");

module.exports = {
    name: "calculate_indicator",
    description: "Calculate a technical indicator (RSI or SMA) for a single stock from its stored daily candles.",
    parameters: {
        type: "object",
        properties: {
            symbol: { type: "string", description: "NSE trading symbol" },
            indicator: { type: "string", enum: ["RSI", "SMA"] },
            period: { type: "number", description: "Lookback period -- default 14 for RSI, 20 for SMA" },
        },
        required: ["symbol", "indicator"],
    },
    async execute({ symbol, indicator, period }) {
        const candles = await getCandlesForYears(symbol, 1);
        if (candles.length === 0) {
            return { symbol: symbol.toUpperCase(), error: "No stored historical data. It may need to be synced first." };
        }

        const upperIndicator = indicator.toUpperCase();

        if (upperIndicator === "RSI") {
            const resolvedPeriod = period || 14;
            return { symbol: symbol.toUpperCase(), indicator: "RSI", period: resolvedPeriod, value: calculateRSI(candles, resolvedPeriod) };
        }

        if (upperIndicator === "SMA") {
            const resolvedPeriod = period || 20;
            return { symbol: symbol.toUpperCase(), indicator: "SMA", period: resolvedPeriod, value: calculateSMA(candles, resolvedPeriod) };
        }

        return { error: `Unsupported indicator: ${indicator}. Use RSI or SMA.` };
    },
};
