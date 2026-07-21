const { getCandlesForYears } = require("../lib/marketData");

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Buckets the follow-through move (from the threshold price to the day's
// close) so a caller can see the shape of the distribution, not just the
// average -- e.g. "60% growth probability" could hide that most winners
// only crept up 0.5% while a few ran to 8%.
const BUCKETS = [
    { label: "pulled back below threshold", test: (pct) => pct < 0 },
    { label: "0% to 1% further", test: (pct) => pct >= 0 && pct < 1 },
    { label: "1% to 2% further", test: (pct) => pct >= 1 && pct < 2 },
    { label: "2% to 3% further", test: (pct) => pct >= 2 && pct < 3 },
    { label: "3% to 5% further", test: (pct) => pct >= 3 && pct < 5 },
    { label: "5%+ further", test: (pct) => pct >= 5 },
];

module.exports = {
    name: "analyze_growth_after_threshold",
    description:
        "Backtests a stock's own trading history to answer 'what happens after this stock moves X% up from its opening price'. " +
        "For every historical day where the stock's intraday high reached at least X% above that day's open, checks whether the " +
        "close held above that X% level (further growth/continuation) or fell back below it (reversal) by end of day. Returns the " +
        "resulting growth probability, average/median follow-through move, and a bucketed distribution. Use this for questions like " +
        "'what is the growth probability after RELIANCE hits 3% from its opening price'.",
    parameters: {
        type: "object",
        properties: {
            symbol: { type: "string", description: "NSE trading symbol, e.g. RELIANCE" },
            threshold: { type: "number", description: "Percent above the day's open that defines a 'hit', default 3" },
            years: { type: "number", description: "Years of daily history to backtest over, default 3" },
        },
        required: ["symbol"],
    },
    async execute({ symbol, threshold = 3, years = 3 }) {
        const candles = await getCandlesForYears(symbol, years);
        if (candles.length === 0) {
            return { symbol: symbol.toUpperCase(), error: "No stored historical data. It may need to be synced first." };
        }

        const followThroughPercents = [];

        for (const candle of candles) {
            const open = Number(candle.open);
            const high = Number(candle.high);
            const close = Number(candle.close);
            const thresholdPrice = open * (1 + threshold / 100);

            if (high >= thresholdPrice) {
                followThroughPercents.push(((close - thresholdPrice) / thresholdPrice) * 100);
            }
        }

        const daysAnalyzed = candles.length;
        const daysHitThreshold = followThroughPercents.length;

        if (daysHitThreshold === 0) {
            return {
                symbol: symbol.toUpperCase(),
                threshold,
                years,
                daysAnalyzed,
                daysHitThreshold: 0,
                message: `${symbol.toUpperCase()} never had an intraday move of ${threshold}%+ from its open in the last ${years} year(s).`,
            };
        }

        const daysGrewFurther = followThroughPercents.filter((pct) => pct >= 0).length;

        const distribution = BUCKETS.map((bucket) => ({
            range: bucket.label,
            count: followThroughPercents.filter(bucket.test).length,
        }));

        return {
            symbol: symbol.toUpperCase(),
            threshold,
            years,
            daysAnalyzed,
            daysHitThreshold,
            growthProbabilityPercent: Number(((daysGrewFurther / daysHitThreshold) * 100).toFixed(2)),
            averageFollowThroughPercent: Number(
                (followThroughPercents.reduce((sum, pct) => sum + pct, 0) / daysHitThreshold).toFixed(2)
            ),
            medianFollowThroughPercent: Number(median(followThroughPercents).toFixed(2)),
            distribution,
        };
    },
};
