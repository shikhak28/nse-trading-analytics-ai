const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const fs = require("fs");
const db = require("../config/db");

const INTERVAL = process.argv[2] || "minute";
const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "csv-exports");

const CSV_HEADER = "date,open,high,low,close,volume\n";

function toCsvRow(row) {
    return [row.candle_timestamp.toISOString(), row.open, row.high, row.low, row.close, row.volume].join(",") + "\n";
}

/**
 * One CSV per company (skips symbols with zero rows for this interval,
 * rather than writing an empty header-only file for every untraded/
 * not-yet-synced symbol -- most of the ~2400 companies won't have full
 * minute-level history yet). Streams each symbol's own query result
 * straight to its own file, one company at a time -- avoids loading all
 * 100M+ rows into memory at once.
 */
async function exportAll() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const { rows: companies } = await db.query(`SELECT exchange, symbol FROM companies ORDER BY exchange, symbol`);
    console.log(`[export] ${companies.length} companies to check (interval=${INTERVAL})`);

    let exported = 0;
    let skipped = 0;

    for (const company of companies) {
        const { rows } = await db.query(
            `SELECT candle_timestamp, open, high, low, close, volume
             FROM historical_prices
             WHERE exchange = $1 AND symbol = $2 AND interval = $3
             ORDER BY candle_timestamp ASC`,
            [company.exchange, company.symbol, INTERVAL]
        );

        if (rows.length === 0) {
            skipped++;
            continue;
        }

        const filePath = path.join(OUTPUT_DIR, `${company.exchange}_${company.symbol}.csv`);
        const body = rows.map(toCsvRow).join("");
        fs.writeFileSync(filePath, CSV_HEADER + body);
        exported++;

        if (exported % 100 === 0) {
            console.log(`[export] ${exported} files written so far...`);
        }
    }

    console.log(`[export] done -- ${exported} CSV files written, ${skipped} companies skipped (no ${INTERVAL} data). Output: ${OUTPUT_DIR}`);
}

exportAll()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[export] failed:", err.message);
        process.exit(1);
    });
