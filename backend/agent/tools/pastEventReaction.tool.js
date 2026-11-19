const { CATEGORY_NAMES, pastEventReactions, typicalDailyMove, eventHistoryCoverage, round } = require("../lib/events");

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

module.exports = {
    name: "past_event_reaction",
    description:
        "How did one stock's price react on its past corporate events (results, buyback, bonus, ...)? Returns the move on the event day, " +
        "the next day, and over both, compared with the stock's normal daily move. Use for 'how much did X move on last results'.",
    parameters: {
        type: "object",
        properties: {
            symbol: { type: "string", description: "NSE symbol" },
            category: { type: "string", enum: CATEGORY_NAMES, description: "Only this event type (e.g. Results)" },
        },
        required: ["symbol"],
    },
    async execute({ symbol, category } = {}) {
        const [events, normal, coverage] = await Promise.all([
            pastEventReactions({ symbol, category, daysBack: 3650, limit: 50 }),
            typicalDailyMove(symbol),
            eventHistoryCoverage(),
        ]);
        const priced = events.filter((e) => e.twoDayPct != null);
        const absTwo = priced.map((e) => Math.abs(e.twoDayPct));

        return {
            symbol: symbol.toUpperCase(),
            normalDailyMovePct: normal,
            eventsFound: events.length,
            avgAbsTwoDayMovePct: round(avg(absTwo)),
            timesBiggerThanNormal: normal && absTwo.length ? round(avg(absTwo) / normal, 1) : null,
            upCount: priced.filter((e) => e.twoDayPct > 0).length,
            downCount: priced.filter((e) => e.twoDayPct < 0).length,
            events,
            note:
                events.length === 0
                    ? `No past events stored for this stock. Event history only builds up from uploaded NSE event calendar CSVs ` +
                      `(${coverage.past_events} past events stored in total). Uploading older calendars fills this in.`
                    : "Moves are close-to-close. Few events means the average is not reliable.",
        };
    },
};
