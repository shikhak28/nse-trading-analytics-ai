const { getUpcomingEvents } = require("../../services/events.service");
const { CATEGORY_NAMES, categoriesFor, latestModelView, modelSummary } = require("../lib/events");

module.exports = {
    name: "get_upcoming_events",
    description:
        "List upcoming corporate events (quarterly results, buyback, bonus, dividend, split, fund raising) from the uploaded NSE event calendar, " +
        "with the model's latest next-day view of each stock. Use for 'whose results are this week', 'any buybacks coming', " +
        "'upcoming results in liquid stocks'.",
    parameters: {
        type: "object",
        properties: {
            days: { type: "number", description: "How many days ahead to look (default 7, max 60)" },
            category: { type: "string", enum: CATEGORY_NAMES, description: "Only this event type" },
            liquidOnly: { type: "boolean", description: "Only liquid stocks (₹20 Cr+ traded per day, not SME)" },
            symbol: { type: "string", description: "Only this NSE symbol" },
        },
    },
    async execute({ days = 7, category, liquidOnly = false, symbol } = {}) {
        const window = Math.min(Math.max(Number(days) || 7, 1), 60);
        const [events, model] = await Promise.all([getUpcomingEvents({ days: window, resultsOnly: false }), latestModelView()]);

        const wanted = symbol?.toUpperCase();
        const rows = events
            .map((e) => {
                const view = modelSummary(model.byKey.get(`${e.exchange}:${e.symbol}`));
                return {
                    symbol: e.symbol,
                    company: e.company_name,
                    eventDate: e.event_date,
                    daysLeft: e.days_left,
                    purpose: e.purpose,
                    categories: categoriesFor(`${e.purpose} ${e.details || ""}`),
                    model: view,
                };
            })
            .filter((r) => !wanted || r.symbol === wanted || r.symbol.startsWith(`${wanted}-`))
            .filter((r) => !category || r.categories.some((c) => c.toLowerCase() === category.toLowerCase()))
            .filter((r) => !liquidOnly || r.model?.liquid);

        return {
            daysAhead: window,
            modelPredictionDay: model.day,
            count: rows.length,
            events: rows.slice(0, 60),
            note:
                rows.length === 0
                    ? "No matching events. The calendar only knows what was uploaded on the Upcoming Results page."
                    : "Model view is for the next trading day only, not the event day, and the model does not know about the event.",
        };
    },
};
