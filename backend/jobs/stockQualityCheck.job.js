const db = require("../config/db");
const kite = require("../config/kite");
const authService = require("../services/auth.service");
const { isRealEquity } = require("./instrumentMasterRefresh.job");

const REASONS = {
    DELISTED: "delisted", // no longer in Kite's instrument list
    NOT_EQUITY: "not_equity", // bond, NAV feed, index etc. imported before the filters existed
    NO_RECENT_TRADING: "no_recent_trading", // has history, but no volume lately
};

const NO_TRADE_DAYS = 30;

// Below this share of the exchange having recent volume, the sync is
// unfinished rather than most stocks having stopped trading.
const MIN_RECENTLY_TRADED_SHARE = 0.7;

// A bad Kite response or a broken sync would otherwise hide most of the site
// in one run, so a run this large changes nothing unless forced.
const MAX_NEWLY_HIDDEN_SHARE = 0.5;

/**
 * Symbols with volume in the NO_TRADE_DAYS before the exchange's newest daily
 * candle. Measured from that candle rather than today, so a machine that was
 * off for a month doesn't make every stock look dead. Null when the candles
 * are too incomplete for trading activity to be judged.
 */
async function getTradedSymbols(exchange, companyCount) {
    const { rows } = await db.query(
        `SELECT max(candle_timestamp) AS latest
         FROM historical_prices
         WHERE exchange = $1 AND interval = 'day' AND candle_timestamp >= NOW() - INTERVAL '60 days'`,
        [exchange]
    );
    const latest = rows[0].latest;
    if (!latest) return null;

    const traded = await db.query(
        `SELECT DISTINCT symbol
         FROM historical_prices
         WHERE exchange = $1 AND interval = 'day' AND volume > 0
           AND candle_timestamp >= $2::timestamp - make_interval(days => $3)`,
        [exchange, latest, NO_TRADE_DAYS]
    );
    if (traded.rows.length < companyCount * MIN_RECENTLY_TRADED_SHARE) return null;
    return new Set(traded.rows.map((row) => row.symbol));
}

// A stock that was never synced has no candles for a data reason, not a
// market one, so only symbols with some daily history can be judged inactive.
async function getSymbolsWithHistory(exchange, symbols) {
    if (symbols.length === 0) return new Set();
    const { rows } = await db.query(
        `SELECT c.symbol
         FROM companies c
         WHERE c.exchange = $1 AND c.symbol = ANY($2)
           AND EXISTS (
             SELECT 1 FROM historical_prices h
             WHERE h.exchange = c.exchange AND h.symbol = c.symbol AND h.interval = 'day'
           )`,
        [exchange, symbols]
    );
    return new Set(rows.map((row) => row.symbol));
}

async function checkExchange(exchange, { apply, force }) {
    const instruments = await kite.getInstruments(exchange);
    const listed = new Map();
    for (const instrument of Array.isArray(instruments) ? instruments : []) {
        const symbol = (instrument.tradingsymbol || "").toUpperCase();
        if (!listed.has(symbol) || isRealEquity(instrument, exchange)) {
            listed.set(symbol, instrument);
        }
    }
    if (listed.size === 0) {
        throw new Error(`Kite returned no instruments for ${exchange}`);
    }

    const { rows: companies } = await db.query(
        `SELECT symbol, company_name, excluded_reason, force_include FROM companies WHERE exchange = $1`,
        [exchange]
    );
    const traded = await getTradedSymbols(exchange, companies.length);

    const listingReason = (company) => {
        const instrument = listed.get(company.symbol);
        if (!instrument) return REASONS.DELISTED;
        return isRealEquity(instrument, exchange) ? null : REASONS.NOT_EQUITY;
    };

    const silent = traded
        ? companies.filter((c) => !c.force_include && !listingReason(c) && !traded.has(c.symbol))
        : [];
    const withHistory = await getSymbolsWithHistory(exchange, silent.map((c) => c.symbol));

    const decide = (company) => {
        if (company.force_include) return null;
        const reason = listingReason(company);
        if (reason) return reason;
        // No candle data to judge by: leave an earlier verdict as it was.
        if (!traded) return company.excluded_reason === REASONS.NO_RECENT_TRADING ? company.excluded_reason : null;
        return !traded.has(company.symbol) && withHistory.has(company.symbol) ? REASONS.NO_RECENT_TRADING : null;
    };

    const decided = companies.map((company) => ({ ...company, reason: decide(company) }));
    const changed = decided.filter((c) => c.reason !== c.excluded_reason);
    const newlyHidden = changed.filter((c) => c.reason && !c.excluded_reason);
    const restored = changed.filter((c) => !c.reason);

    const hidden = {};
    for (const company of decided) {
        if (company.reason) (hidden[company.reason] ||= []).push(company);
    }

    const blocked = !force && newlyHidden.length > companies.length * MAX_NEWLY_HIDDEN_SHARE;

    if (apply && !blocked && changed.length > 0) {
        await db.query(
            `UPDATE companies c
             SET excluded_reason = v.reason,
                 excluded_at = CASE WHEN v.reason IS NULL THEN NULL ELSE NOW() END
             FROM unnest($2::text[], $3::text[]) AS v(symbol, reason)
             WHERE c.exchange = $1 AND c.symbol = v.symbol`,
            [exchange, changed.map((c) => c.symbol), changed.map((c) => c.reason)]
        );
    }

    return {
        exchange,
        total: companies.length,
        hidden,
        newlyHidden,
        restored,
        neverSynced: silent.length - withHistory.size,
        tradingJudged: Boolean(traded),
        blocked,
        applied: apply && !blocked,
    };
}

async function getExchanges() {
    const { rows } = await db.query(`SELECT DISTINCT exchange FROM companies WHERE exchange IS NOT NULL ORDER BY exchange`);
    return rows.map((row) => row.exchange);
}

async function processStockQualityCheck() {
    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.log("[stock-quality-check] skipped: not authenticated with Zerodha");
        return { skipped: true, reason: "not_authenticated" };
    }

    const summary = [];
    for (const exchange of await getExchanges()) {
        const result = await checkExchange(exchange, { apply: true, force: false });
        const counts = Object.fromEntries(Object.entries(result.hidden).map(([reason, rows]) => [reason, rows.length]));
        console.log(
            `[stock-quality-check] ${exchange}: ${JSON.stringify(counts)}, ${result.newlyHidden.length} newly hidden, ${result.restored.length} restored` +
                (result.blocked ? " -- BLOCKED by safety limit, nothing changed" : "")
        );
        summary.push({ exchange, ...counts, blocked: result.blocked });
    }
    return summary;
}

module.exports = { processStockQualityCheck, checkExchange, getExchanges };
