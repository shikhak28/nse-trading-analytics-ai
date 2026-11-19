const { attachNextResult } = require("../../services/events.service");
const { latestModelView, modelSummary } = require("../lib/events");

module.exports = {
    name: "get_model_prediction",
    description:
        "Get the platform ML model's latest next-trading-day prediction for one or more NSE stocks: expected % move, " +
        "chance of a ≥2% rise, chance of a ≥2% fall, likely range, signal, liquidity, and next result date if known. " +
        "Use for 'what does the model say about X', 'prediction for X tomorrow'.",
    parameters: {
        type: "object",
        properties: {
            symbols: { type: "array", items: { type: "string" }, description: "NSE symbols, e.g. [\"TCS\", \"DALBHARAT\"]" },
        },
        required: ["symbols"],
    },
    async execute({ symbols = [] } = {}) {
        const model = await latestModelView();
        const list = (Array.isArray(symbols) ? symbols : [symbols]).slice(0, 20).map((s) => String(s).trim().toUpperCase());

        const rows = list.map((symbol) => {
            const key = [symbol, `${symbol}-BE`, `${symbol}-SM`, `${symbol}-ST`, `${symbol}-BZ`]
                .map((s) => `NSE:${s}`)
                .find((k) => model.byKey.has(k));
            return key
                ? { exchange: "NSE", symbol: key.slice(4), ...modelSummary(model.byKey.get(key)) }
                : { exchange: "NSE", symbol, error: "No prediction for this stock on the latest day (not synced, or no candle that day)" };
        });

        const withResults = await attachNextResult(rows);
        return {
            predictionMadeOn: model.day,
            forDay: "next trading day after predictionMadeOn",
            predictions: withResults.map(({ exchange, next_result_date, next_result_days, ...r }) => ({
                ...r,
                nextResultDate: next_result_date ?? null,
                nextResultInDays: next_result_days ?? null,
            })),
            note: "Research only. The model uses past price/volume and market breadth; it does not know news or result numbers.",
        };
    },
};
