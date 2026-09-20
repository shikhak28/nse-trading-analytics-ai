const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const fs = require("fs");
const db = require("../config/db");

// One-time import of NSE's sector/industry classification into `companies`
// (migration 018). Expects a CSV with a header row containing at least
// "symbol" and "sector" columns (case-insensitive), optionally "industry"
// and "exchange" (defaults to NSE if absent). Re-runnable -- always UPDATEs
// by symbol+exchange, never inserts new companies.
//
// Usage: node scripts/importSectorData.js path/to/file.csv

function parseCsvLine(line) {
    const fields = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"' && line[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ",") {
            fields.push(field);
            field = "";
        } else {
            field += char;
        }
    }
    fields.push(field);
    return fields;
}

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

    const symbolIdx = header.indexOf("symbol");
    const sectorIdx = header.indexOf("sector");
    const industryIdx = header.indexOf("industry");
    const exchangeIdx = header.indexOf("exchange");

    if (symbolIdx === -1 || sectorIdx === -1) {
        throw new Error(`CSV header must include "symbol" and "sector" columns. Found: ${header.join(", ")}`);
    }

    return lines.slice(1).map((line) => {
        const fields = parseCsvLine(line);
        return {
            symbol: (fields[symbolIdx] || "").trim().toUpperCase(),
            sector: (fields[sectorIdx] || "").trim() || null,
            industry: industryIdx !== -1 ? (fields[industryIdx] || "").trim() || null : null,
            exchange: exchangeIdx !== -1 ? (fields[exchangeIdx] || "NSE").trim().toUpperCase() : "NSE",
        };
    });
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: node scripts/importSectorData.js path/to/file.csv");
        process.exit(1);
    }

    const text = fs.readFileSync(filePath, "utf8");
    const rows = parseCsv(text).filter((r) => r.symbol && r.sector);

    console.log(`Parsed ${rows.length} row(s) with a symbol and sector from ${filePath}.`);

    let matched = 0;
    const unmatched = [];

    for (const row of rows) {
        const result = await db.query(
            `UPDATE companies SET sector = $1, industry = $2 WHERE exchange = $3 AND symbol = $4`,
            [row.sector, row.industry, row.exchange, row.symbol]
        );
        if (result.rowCount > 0) {
            matched++;
        } else {
            unmatched.push(`${row.exchange}:${row.symbol}`);
        }
    }

    console.log(`Matched and updated ${matched} companies.`);
    if (unmatched.length > 0) {
        console.log(`${unmatched.length} row(s) in the CSV had no matching company (symbol mismatch or not tracked):`);
        console.log(unmatched.slice(0, 30).join(", ") + (unmatched.length > 30 ? ", ..." : ""));
    }

    const stillUncategorized = await db.query(`SELECT count(*) FROM companies WHERE sector IS NULL`);
    console.log(`${stillUncategorized.rows[0].count} companies still have no sector after this import.`);

    process.exit(0);
}

main().catch((err) => {
    console.error("Import failed:", err.message);
    process.exit(1);
});
