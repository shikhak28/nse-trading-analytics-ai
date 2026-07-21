const db = require("../config/db");

const COLUMNS = [
    "exchange", "symbol", "snapshot_timestamp", "ltp",
    "buy1_price", "buy1_qty", "buy1_orders",
    "buy2_price", "buy2_qty", "buy2_orders",
    "buy3_price", "buy3_qty", "buy3_orders",
    "buy4_price", "buy4_qty", "buy4_orders",
    "buy5_price", "buy5_qty", "buy5_orders",
    "sell1_price", "sell1_qty", "sell1_orders",
    "sell2_price", "sell2_qty", "sell2_orders",
    "sell3_price", "sell3_qty", "sell3_orders",
    "sell4_price", "sell4_qty", "sell4_orders",
    "sell5_price", "sell5_qty", "sell5_orders",
    "total_buy_quantity", "total_sell_quantity",
];

const PARAMS_PER_ROW = COLUMNS.length;
// Postgres caps bound parameters at 65535 per query. At 36 columns/row,
// 500 rows/batch stays comfortably under that (18,000 params) -- same
// batching lesson learned from market.service.js's saveHistoricalPrices,
// just a smaller page size since this table is much wider per row.
const MAX_ROWS_PER_INSERT = 500;

/**
 * Bulk-inserts one depth snapshot per row. Each row is built by the caller
 * (see depthSnapshot.job.js) from a live tick's depth object -- levels
 * missing from the order book (e.g. a thin/illiquid symbol with fewer than
 * 5 resting orders on one side) come through as null, not zero, so a
 * missing level is visibly distinct from a real zero-quantity level.
 */
async function saveSnapshots(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return 0;
    }

    for (let start = 0; start < rows.length; start += MAX_ROWS_PER_INSERT) {
        const page = rows.slice(start, start + MAX_ROWS_PER_INSERT);

        const values = [];
        const placeholders = [];

        page.forEach((row, index) => {
            const offset = index * PARAMS_PER_ROW;
            const rowPlaceholders = COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`);
            placeholders.push(`(${rowPlaceholders.join(", ")})`);
            values.push(...COLUMNS.map((col) => row[col] ?? null));
        });

        const query = `
            INSERT INTO depth_snapshots(${COLUMNS.join(", ")})
            VALUES ${placeholders.join(", ")}
            ON CONFLICT (exchange, symbol, snapshot_timestamp) DO UPDATE SET
                ltp = EXCLUDED.ltp,
                buy1_price = EXCLUDED.buy1_price, buy1_qty = EXCLUDED.buy1_qty, buy1_orders = EXCLUDED.buy1_orders,
                buy2_price = EXCLUDED.buy2_price, buy2_qty = EXCLUDED.buy2_qty, buy2_orders = EXCLUDED.buy2_orders,
                buy3_price = EXCLUDED.buy3_price, buy3_qty = EXCLUDED.buy3_qty, buy3_orders = EXCLUDED.buy3_orders,
                buy4_price = EXCLUDED.buy4_price, buy4_qty = EXCLUDED.buy4_qty, buy4_orders = EXCLUDED.buy4_orders,
                buy5_price = EXCLUDED.buy5_price, buy5_qty = EXCLUDED.buy5_qty, buy5_orders = EXCLUDED.buy5_orders,
                sell1_price = EXCLUDED.sell1_price, sell1_qty = EXCLUDED.sell1_qty, sell1_orders = EXCLUDED.sell1_orders,
                sell2_price = EXCLUDED.sell2_price, sell2_qty = EXCLUDED.sell2_qty, sell2_orders = EXCLUDED.sell2_orders,
                sell3_price = EXCLUDED.sell3_price, sell3_qty = EXCLUDED.sell3_qty, sell3_orders = EXCLUDED.sell3_orders,
                sell4_price = EXCLUDED.sell4_price, sell4_qty = EXCLUDED.sell4_qty, sell4_orders = EXCLUDED.sell4_orders,
                sell5_price = EXCLUDED.sell5_price, sell5_qty = EXCLUDED.sell5_qty, sell5_orders = EXCLUDED.sell5_orders,
                total_buy_quantity = EXCLUDED.total_buy_quantity,
                total_sell_quantity = EXCLUDED.total_sell_quantity
        `;

        await db.query(query, values);
    }

    return rows.length;
}

/**
 * Stored depth snapshots for a single symbol within an optional time range --
 * same shape/param pattern as market.service.js's getStoredHistoricalPrices.
 */
async function getStoredDepthSnapshots(symbol, exchange = "NSE", from, to, limit = 500) {
    const values = [exchange.toUpperCase(), symbol.toUpperCase()];
    let where = `exchange = $1 AND symbol = $2`;

    if (from) {
        values.push(new Date(from));
        where += ` AND snapshot_timestamp >= $${values.length}`;
    }

    if (to) {
        values.push(new Date(to));
        where += ` AND snapshot_timestamp <= $${values.length}`;
    }

    values.push(limit);

    const result = await db.query(
        `
        SELECT ${COLUMNS.join(", ")}
        FROM depth_snapshots
        WHERE ${where}
        ORDER BY snapshot_timestamp DESC
        LIMIT $${values.length}
        `,
        values
    );

    return result.rows;
}

/**
 * Most recent depth snapshot timestamp across all symbols -- used by the
 * dashboard to show how fresh the captured order-book data is. Depth is
 * capture-only-going-forward (no historical-depth API, see migration 009),
 * so the last 7 days always contains the true max; bounding the scan avoids
 * fanning out across every monthly partition (same lesson as the
 * historical_prices queries in market.service.js).
 */
async function getLatestSnapshotTimestamp() {
    const result = await db.query(
        `SELECT MAX(snapshot_timestamp) AS last_snapshot FROM depth_snapshots
         WHERE snapshot_timestamp >= NOW() - INTERVAL '7 days'`
    );

    return result.rows[0]?.last_snapshot || null;
}

module.exports = { saveSnapshots, getStoredDepthSnapshots, getLatestSnapshotTimestamp, COLUMNS };
