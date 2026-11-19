const { CATEGORY_NAMES, pastEventReactions, eventHistoryCoverage, round } = require("../lib/events");

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

module.exports = {
    name: "event_type_stats",
    description:
        "Across all stocks, how do prices react to each type of corporate event (Results, Buyback, Bonus, Dividend, Split, Fund Raising)? " +
        "Returns count, average and median 2-day move, average absolute move, and % of events that went up. " +
        "Use for 'do stocks rise after buyback announcements', 'which event type moves prices most'.",
    parameters: {
        type: "object",
        properties: {
            category: { type: "string", enum: CATEGORY_NAMES, description: "Only this event type (default: all types)" },
            daysBack: { type: "number", description: "Look back this many days (default 365)" },
        },
    },
    async execute({ category, daysBack = 365 } = {}) {
        const [events, coverage] = await Promise.all([
            pastEventReactions({ category, daysBack: Math.min(Math.max(Number(daysBack) || 365, 7), 3650), limit: 20000 }),
            eventHistoryCoverage(),
        ]);

        const groups = new Map();
        for (const e of events) {
            if (e.twoDayPct == null) continue;
            for (const c of e.categories) {
                if (category && c.toLowerCase() !== category.toLowerCase()) continue;
                if (!groups.has(c)) groups.set(c, []);
                groups.get(c).push(e);
            }
        }

        const stats = [...groups.entries()]
            .map(([name, list]) => {
                const two = list.map((e) => e.twoDayPct);
                const sorted = [...list].sort((a, b) => b.twoDayPct - a.twoDayPct);
                return {
                    category: name,
                    events: list.length,
                    avgTwoDayPct: round(avg(two)),
                    medianTwoDayPct: round(median(two)),
                    avgAbsTwoDayPct: round(avg(two.map(Math.abs))),
                    pctWentUp: round((100 * two.filter((x) => x > 0).length) / two.length, 1),
                    biggestGain: sorted[0] && { symbol: sorted[0].symbol, date: sorted[0].eventDate, pct: sorted[0].twoDayPct },
                    biggestLoss: sorted.at(-1) && { symbol: sorted.at(-1).symbol, date: sorted.at(-1).eventDate, pct: sorted.at(-1).twoDayPct },
                };
            })
            .sort((a, b) => b.events - a.events);

        return {
            daysBack,
            pastEventsStored: coverage.past_events,
            earliestEventStored: coverage.earliest,
            stats,
            note:
                stats.length === 0
                    ? "No past events with price data yet. History only builds from uploaded NSE event calendar CSVs; upload older calendars to fill it."
                    : "Under ~30 events in a group, treat the numbers as anecdotes, not a pattern. Moves are close-to-close, not after costs.",
        };
    },
};
