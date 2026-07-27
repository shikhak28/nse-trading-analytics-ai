const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const kite = require("../config/kite");
const authService = require("../services/auth.service");

const exchange = (process.argv[3] || "NSE").toUpperCase();
const symbols = (process.argv[2] || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

// For symbols still failing sync after instrument-master-refresh: checks
// whether each one exists at all in Kite's *current* EQ dump for the given
// exchange -- upsertCompanies only touches rows present in that dump, so a
// symbol absent from it (delisted/renamed/segment-moved) explains why its
// stale instrument_token in `companies` was never refreshed.
(async () => {
    if (symbols.length === 0) {
        console.error("Usage: node scripts/checkStaleSymbols.js SYM1,SYM2,SYM3 [exchange=NSE]");
        process.exit(1);
    }

    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.error("Not authenticated with Zerodha -- run /auth/login first.");
        process.exit(1);
    }

    const instruments = await kite.getInstruments(exchange);
    const bySymbol = new Map(instruments.map((i) => [i.tradingsymbol.toUpperCase(), i]));

    for (const symbol of symbols) {
        const match = bySymbol.get(symbol);
        if (!match) {
            console.log(`${symbol}: NOT FOUND in current ${exchange} dump (likely delisted/renamed/moved segment)`);
        } else {
            console.log(`${symbol}: found -- instrument_token=${match.instrument_token}, type=${match.instrument_type}, segment=${match.segment}`);
        }
    }

    process.exit(0);
})().catch((err) => {
    console.error("[check-stale-symbols] failed:", err.message);
    process.exit(1);
});
