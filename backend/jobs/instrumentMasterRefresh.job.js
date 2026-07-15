const kite = require("../config/kite");
const authService = require("../services/auth.service");
const marketService = require("../services/market.service");

const UPSERT_CHUNK_SIZE = 500;

// Kite's EQ dump also includes government/corporate debt (SDLs, G-Secs,
// NCDs) tagged with the same segment+instrument_type as real equities.
// NSE's debt symbols consistently end in a hyphen + a short (2-char)
// alphanumeric code -- e.g. "656KA30-SG" (a Karnataka state loan) -- a
// pattern real trading symbols don't share (verified against edge cases
// like BAJAJ-AUTO, BOSCH-HCIL, 21STCENMGM).
const DEBT_INSTRUMENT_SYMBOL = /-[A-Z0-9]{2}$/;

// BSE's debt symbols don't follow that hyphen convention (e.g. "ABHF090326",
// "97SFL29") so the regex above doesn't generalize -- but Kite simply leaves
// `name` blank for these across both exchanges (a real company's `name` is
// never empty). Requiring a non-empty name is a broader, exchange-agnostic
// signal and catches what the regex misses.
function hasCompanyName(instrument) {
    return typeof instrument.name === "string" && instrument.name.trim().length > 0;
}

// ETF/mutual-fund "Indicative NAV" feeds -- Kite tags these EQ with a real
// `name`, so they pass every other filter, but they're a live NAV quote for
// a fund (no OHLC candles ever exist for them), not a company. NSE always
// suffixes their tradingsymbol with "INAV" (e.g. "GOLDBEINAV", "AXISNIINAV").
const INAV_SYMBOL = /INAV$/;

function isInavFeed(instrument) {
    return INAV_SYMBOL.test(instrument.tradingsymbol);
}

/**
 * Refreshes the companies table from Kite's instrument dump for a given
 * exchange. Filtered to plain equities (instrument_type EQ) -- the raw dump
 * also includes F&O/currency contracts and debt securities, which aren't
 * "companies" for this app's purposes.
 */
async function processInstrumentMasterRefresh(job) {
    const { exchange = "NSE" } = job.data || {};

    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        console.log("[instrument-master-refresh] skipped: not authenticated with Zerodha");
        return { skipped: true, reason: "not_authenticated" };
    }

    const instruments = await kite.getInstruments(exchange);
    const companies = (Array.isArray(instruments) ? instruments : [])
        .filter((instrument) =>
            // Kite tags an instrument's segment to match the exchange it was
            // requested for (NSE instruments -> segment "NSE", BSE -> "BSE")
            // -- hardcoding "NSE" here would silently drop every BSE row.
            instrument.segment === exchange &&
            instrument.instrument_type === "EQ" &&
            !DEBT_INSTRUMENT_SYMBOL.test(instrument.tradingsymbol) &&
            !isInavFeed(instrument) &&
            hasCompanyName(instrument)
        )
        .map((instrument) => ({
            symbol: instrument.tradingsymbol.toUpperCase(),
            company_name: instrument.name,
            exchange,
            instrument_token: instrument.instrument_token,
            segment: instrument.segment,
            exchange_token: instrument.exchange_token,
        }));

    for (let i = 0; i < companies.length; i += UPSERT_CHUNK_SIZE) {
        await marketService.upsertCompanies(companies.slice(i, i + UPSERT_CHUNK_SIZE));
    }

    console.log(`[instrument-master-refresh] upserted ${companies.length} ${exchange} equities`);
    return { count: companies.length, exchange };
}

module.exports = { processInstrumentMasterRefresh };
