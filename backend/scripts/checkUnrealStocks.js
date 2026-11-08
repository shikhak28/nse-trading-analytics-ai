const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const db = require("../config/db");
const authService = require("../services/auth.service");
const { checkExchange, getExchanges } = require("../jobs/stockQualityCheck.job");

// Usage (from backend/):
//   node scripts/checkUnrealStocks.js                 preview only, changes nothing
//   node scripts/checkUnrealStocks.js --all           preview, listing every stock
//   node scripts/checkUnrealStocks.js --apply         hide what the preview shows
//   node scripts/checkUnrealStocks.js --apply --force apply past the safety limit
//   node scripts/checkUnrealStocks.js --keep NSE:ABC  never hide this stock again

const PREVIEW_PER_REASON = 30;

function flagValue(args, name) {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
}

async function keepStock(target) {
    const [exchange, symbol] = (target || "").toUpperCase().split(":");
    if (!exchange || !symbol) {
        throw new Error("--keep needs EXCHANGE:SYMBOL, e.g. --keep NSE:RELIANCE");
    }
    const { rowCount } = await db.query(
        `UPDATE companies SET force_include = true, excluded_reason = NULL, excluded_at = NULL
         WHERE exchange = $1 AND symbol = $2`,
        [exchange, symbol]
    );
    console.log(rowCount ? `${exchange}:${symbol} will stay visible.` : `${exchange}:${symbol} not found in companies.`);
}

function printResult(result, showAll) {
    console.log(`\n=== ${result.exchange}: ${result.total} stocks ===`);
    for (const [reason, rows] of Object.entries(result.hidden)) {
        console.log(`\n${reason}: ${rows.length}`);
        for (const row of showAll ? rows : rows.slice(0, PREVIEW_PER_REASON)) {
            console.log(`  ${row.symbol.padEnd(24)} ${row.company_name || "(no name)"}`);
        }
        if (!showAll && rows.length > PREVIEW_PER_REASON) {
            console.log(`  ... and ${rows.length - PREVIEW_PER_REASON} more (use --all)`);
        }
    }
    console.log(`\nNewly hidden: ${result.newlyHidden.length}   Restored: ${result.restored.length}`);
    console.log(`Never synced, left visible: ${result.neverSynced}`);
    if (!result.tradingJudged) console.log("No recent candles for this exchange, so trading activity was not checked.");
    if (result.blocked) console.log("BLOCKED: this would hide over half the exchange. Nothing changed. Review, then use --force.");
}

(async () => {
    const args = process.argv.slice(2);

    if (args.includes("--keep")) {
        await keepStock(flagValue(args, "--keep"));
        process.exit(0);
    }

    if (!(await authService.loadAccessToken())) {
        throw new Error("Not logged in to Zerodha. Log in on the site first.");
    }

    const apply = args.includes("--apply");
    for (const exchange of await getExchanges()) {
        const result = await checkExchange(exchange, { apply, force: args.includes("--force") });
        printResult(result, args.includes("--all"));
    }
    console.log(apply ? "\nDone." : "\nPreview only, nothing changed. Run with --apply to hide these.");
    process.exit(0);
})().catch((err) => {
    console.error("[check-unreal-stocks] failed:", err.message);
    process.exit(1);
});
