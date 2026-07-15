const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const db = require("../config/db");

(async () => {
    const totals = await db.query("SELECT exchange, count(*) FROM companies GROUP BY exchange ORDER BY exchange");
    console.log("Total companies per exchange:", totals.rows);

    const nullFields = await db.query(`
        SELECT
            count(*) FILTER (WHERE company_name IS NULL OR trim(company_name) = '') AS missing_company_name,
            count(*) FILTER (WHERE instrument_token IS NULL OR trim(instrument_token) = '') AS missing_instrument_token,
            count(*) FILTER (WHERE segment IS NULL OR trim(segment) = '') AS missing_segment,
            count(*) FILTER (WHERE exchange_token IS NULL OR trim(exchange_token) = '') AS missing_exchange_token
        FROM companies
    `);
    console.log("Companies with null/blank fields:", nullFields.rows[0]);

    if (Number(nullFields.rows[0].missing_company_name) > 0) {
        const sample = await db.query(`
            SELECT exchange, symbol, instrument_token FROM companies
            WHERE company_name IS NULL OR trim(company_name) = ''
            LIMIT 10
        `);
        console.log("Sample companies missing company_name:", sample.rows);
    }

    const withoutHistory = await db.query(`
        SELECT count(*) FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM historical_prices h WHERE h.exchange = c.exchange AND h.symbol = c.symbol)
    `);
    console.log("Companies with ZERO historical_prices rows:", withoutHistory.rows[0].count);

    // Deliberately NOT a LEFT JOIN + GROUP BY over all of historical_prices --
    // that requires a full aggregate scan across every monthly partition for
    // all ~2400 companies (60M+ rows), which is the same partition-pruning
    // trap fixed earlier in market.service.js and took 25s+ per run once the
    // backfill filled out most partitions, stacking up badly if the script
    // gets re-run before the previous run finishes. A plain NOT EXISTS list
    // (companies still missing backfill entirely) answers the same practical
    // question -- "who's still not synced" -- via the same cheap semi-join
    // as the count query above, no full-table aggregation needed.
    const stillMissing = await db.query(`
        SELECT c.exchange, c.symbol, c.company_name
        FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM historical_prices h WHERE h.exchange = c.exchange AND h.symbol = c.symbol)
        ORDER BY c.symbol ASC
        LIMIT 20
    `);
    console.log("20 companies still missing historical data entirely:", stillMissing.rows);

    const depthCoverage = await db.query(`
        SELECT count(*) FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM depth_snapshots d WHERE d.exchange = c.exchange AND d.symbol = c.symbol)
    `);
    console.log("Companies with ZERO depth_snapshots rows:", depthCoverage.rows[0].count);

    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
