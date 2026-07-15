const { getCandlesForYears, getTrackedSymbols } = require("../lib/marketData");
const { calculateRSI } = require("../indicators/technicalIndicators");

const OPERATORS = {
    "<": (value, threshold) => value < threshold,
    ">": (value, threshold) => value > threshold,
    "<=": (value, threshold) => value <= threshold,
    ">=": (value, threshold) => value >= threshold,
};

module.exports = {
    name: "screen_by_rsi",
    description:
        "Scan all tracked (synced) stocks and find ones whose RSI matches a condition -- e.g. RSI < 30 (oversold) or RSI > 70 (overbought). Use this for questions like 'find stocks whose RSI is below 30'.",
    parameters: {
        type: "object",
        properties: {
            operator: { type: "string", enum: ["<", ">", "<=", ">="] },
            threshold: { type: "number" },
            period: { type: "number", description: "RSI period, default 14" },
            limit: { type: "number", description: "Max matches to return, default 20" },
        },
        required: ["operator", "threshold"],
    },
    async execute({ operator, threshold, period = 14, limit = 20 }) {
        const compare = OPERATORS[operator];
        if (!compare) {
            return { error: `Unsupported operator: ${operator}` };
        }

        const symbols = await getTrackedSymbols();
        const matches = [];

        for (const symbol of symbols) {
            const candles = await getCandlesForYears(symbol, 1);
            const rsi = calculateRSI(candles, period);
            if (rsi === null) continue;

            if (compare(rsi, threshold)) {
                matches.push({ symbol, rsi: Number(rsi.toFixed(2)) });
                if (matches.length >= limit) break;
            }
        }

        return { operator, threshold, period, matchCount: matches.length, matches };
    },
};
