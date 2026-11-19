const db = require("../config/db");
const kite = require("../config/kite");
const authService = require("./auth.service");
const { chunkDateRange } = require("./sync.service");

// Kite instrument tokens for the indices the model reads.
const INDICES = [
    { symbol: "NIFTY 50", token: 256265 },
    { symbol: "NIFTY BANK", token: 260105 },
    { symbol: "INDIA VIX", token: 264969 },
];

const BACKFILL_YEARS = 3;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

const formatKiteDate = (date) => date.toISOString().slice(0, 19).replace("T", " ");
// Kite's daily candle is stamped at IST midnight; take the IST calendar day.
const istDay = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function saveIndexCandles(symbol, candles) {
    for (let i = 0; i < candles.length; i += 500) {
        const chunk = candles.slice(i, i + 500);
        const values = [];
        const placeholders = chunk.map((c, j) => {
            values.push(symbol, istDay(c.date), c.open, c.high, c.low, c.close);
            const o = j * 6;
            return `($${o + 1}, $${o + 2}::date, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`;
        });
        await db.query(
            `INSERT INTO index_prices (symbol, trade_date, open, high, low, close)
             VALUES ${placeholders.join(",")}
             ON CONFLICT (symbol, trade_date)
             DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                           close = EXCLUDED.close, updated_at = now()`,
            values
        );
    }
}

/**
 * Fetch daily index candles since the last stored day (or BACKFILL_YEARS on
 * the first run). Re-fetches the last stored day so a mid-session candle gets
 * replaced by the final close.
 */
async function syncIndices() {
    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.log("[index-sync] skipped: not authenticated with Zerodha");
        return { skipped: true };
    }

    const now = new Date();
    const summary = {};
    for (const { symbol, token } of INDICES) {
        try {
            const { rows } = await db.query(`SELECT max(trade_date)::text AS last FROM index_prices WHERE symbol = $1`, [symbol]);
            const from = rows[0]?.last
                ? new Date(`${rows[0].last}T00:00:00+05:30`)
                : new Date(now.getFullYear() - BACKFILL_YEARS, now.getMonth(), now.getDate());

            let count = 0;
            for (const chunk of chunkDateRange(from, now, "day")) {
                const candles = await kite.getHistoricalData(token, "day", formatKiteDate(chunk.from), formatKiteDate(chunk.to));
                if (Array.isArray(candles) && candles.length) {
                    await saveIndexCandles(symbol, candles);
                    count += candles.length;
                }
                await sleep(350);
            }
            summary[symbol] = count;
            console.log(`[index-sync] ${symbol}: ${count} candles`);
        } catch (err) {
            summary[symbol] = `error: ${err.message}`;
            console.error(`[index-sync] ${symbol} failed: ${err.message}`);
        }
    }
    return summary;
}

module.exports = { syncIndices, INDICES };
