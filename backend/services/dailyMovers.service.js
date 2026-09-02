const db = require("../config/db");

const RANKED_METRICS = {
    gainers: { orderBy: "change_percent DESC", requiresChange: true },
    losers: { orderBy: "change_percent ASC", requiresChange: true },
    volume: { orderBy: "volume DESC NULLS LAST", requiresChange: false },
};

/**
 * Computes gainers/losers/volume for `date` from historical_prices' day
 * candles -- prev_close comes from a LAG() window over a bounded 10-day
 * lookback (not an unbounded scan) so this stays fast as historical_prices
 * grows, same partition-pruning lesson as market.service.js's other queries.
 */
async function computeRankedMetrics(date) {
    const result = await db.query(
        `
        WITH day_candles AS (
            SELECT
                hp.exchange,
                hp.symbol,
                hp.candle_timestamp::date AS d,
                hp.close,
                hp.volume,
                LAG(hp.close) OVER (PARTITION BY hp.exchange, hp.symbol ORDER BY hp.candle_timestamp) AS prev_close
            FROM historical_prices hp
            WHERE hp.interval = 'day'
              AND hp.candle_timestamp >= ($1::date - INTERVAL '10 days')
              AND hp.candle_timestamp < ($1::date + INTERVAL '1 day')
        )
        SELECT dc.exchange, dc.symbol, c.company_name, dc.close, dc.prev_close, dc.volume,
               CASE WHEN dc.prev_close > 0 THEN ((dc.close - dc.prev_close) / dc.prev_close) * 100 END AS change_percent
        FROM day_candles dc
        JOIN companies c ON c.exchange = dc.exchange AND c.symbol = dc.symbol
        WHERE dc.d = $1::date
        `,
        [date]
    );

    return result.rows;
}

async function upsertSnapshotRows(date, metric, rows) {
    if (rows.length === 0) {
        return;
    }

    const values = [];
    const placeholders = [];

    rows.forEach((row, index) => {
        const offset = index * 10;
        placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
        );
        values.push(
            date,
            metric,
            index + 1,
            row.exchange,
            row.symbol,
            row.company_name,
            row.close ?? null,
            row.prev_close ?? null,
            row.change_percent ?? null,
            row.volume ?? null
        );
    });

    await db.query(
        `
        INSERT INTO daily_movers_snapshot
            (snapshot_date, metric, rank, exchange, symbol, company_name, close, prev_close, change_percent, volume)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (snapshot_date, metric, rank) DO UPDATE SET
            exchange = EXCLUDED.exchange,
            symbol = EXCLUDED.symbol,
            company_name = EXCLUDED.company_name,
            close = EXCLUDED.close,
            prev_close = EXCLUDED.prev_close,
            change_percent = EXCLUDED.change_percent,
            volume = EXCLUDED.volume
        `,
        values
    );
}

/**
 * Computes and stores the 3 leaderboards (gainers/losers/volume) for `date`
 * (a "YYYY-MM-DD" string or Date), capped at `limit` each. Meant to run once
 * per day, after that day's historical-prices EOD sync has landed (see
 * backend/jobs/dailyMoversSnapshot.job.js).
 *
 * top_bid/top_sell (depth-derived) were removed along with depth_snapshots
 * persistence -- see migration 017 -- since depth data isn't used anywhere
 * else either. The total_buy_quantity/total_sell_quantity columns on
 * daily_movers_snapshot stay in the schema (harmless, just always null now)
 * rather than another migration to drop two unused columns.
 */
async function computeAndStoreDailyMovers(date, limit = 20) {
    const ranked = await computeRankedMetrics(date);
    const withChange = ranked.filter((row) => row.change_percent !== null && row.change_percent !== undefined);

    const gainers = [...withChange].sort((a, b) => b.change_percent - a.change_percent).slice(0, limit);
    const losers = [...withChange].sort((a, b) => a.change_percent - b.change_percent).slice(0, limit);
    const volume = [...ranked].filter((row) => row.volume != null).sort((a, b) => b.volume - a.volume).slice(0, limit);

    await upsertSnapshotRows(date, "gainers", gainers);
    await upsertSnapshotRows(date, "losers", losers);
    await upsertSnapshotRows(date, "volume", volume);

    return {
        gainers: gainers.length,
        losers: losers.length,
        volume: volume.length,
    };
}

async function getDailyMovers(date, metric, limit = 20) {
    if (!RANKED_METRICS[metric]) {
        throw new Error(`Unknown movers metric: ${metric}. Expected one of ${Object.keys(RANKED_METRICS).join(", ")}`);
    }

    const result = await db.query(
        `
        SELECT snapshot_date, metric, rank, exchange, symbol, company_name, close, prev_close, change_percent, volume, total_buy_quantity, total_sell_quantity
        FROM daily_movers_snapshot
        WHERE snapshot_date = $1::date AND metric = $2
        ORDER BY rank ASC
        LIMIT $3
        `,
        [date, metric, limit]
    );

    return result.rows;
}

/**
 * Distinct dates that have at least one stored snapshot, most recent first
 * -- backs the dashboard's day-filter dropdown so it only ever offers days
 * that actually have data.
 */
async function getAvailableSnapshotDates(limit = 30) {
    const result = await db.query(
        `SELECT DISTINCT snapshot_date FROM daily_movers_snapshot ORDER BY snapshot_date DESC LIMIT $1`,
        [limit]
    );
    return result.rows.map((row) => row.snapshot_date);
}

module.exports = {
    computeAndStoreDailyMovers,
    getDailyMovers,
    getAvailableSnapshotDates,
    METRICS: Object.keys(RANKED_METRICS),
};
