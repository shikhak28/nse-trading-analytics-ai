const express = require("express");

const router = express.Router();

const marketService = require("../services/market.service");
const depthSnapshotService = require("../services/depthSnapshot.service");
const moversService = require("../services/movers.service");
const dailyMoversService = require("../services/dailyMovers.service");
const authService = require("../services/auth.service");
const kite = require("../config/kite");
const { enqueueSymbolSync } = require("../queues");
const { processDailyEodSync } = require("../jobs/dailyEodSync.job");

/**
 * List stored companies
 */
router.get("/companies", async (req, res) => {
    try {
        const { search, exchange, limit, offset } = req.query;
        const companies = await marketService.getCompanies({
            search: search?.trim() || undefined,
            exchange: exchange?.trim() || undefined,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined,
        });
        return res.json({ success: true, results: companies });
    } catch (err) {
        console.error("Companies fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Manual "catch me up" button -- queues the same day+minute resumable sync
 * for every tracked company that the 4:30 PM IST daily-eod-sync schedule
 * normally fires automatically (see historicalWorker.js). For clicking on
 * demand instead of waiting -- e.g. after skipping a day or several, or
 * running historicalWorker.js only occasionally rather than as a persistent
 * background process. Only enqueues; historicalWorker.js must be running to
 * actually process the queue and pull from Kite.
 */
router.post("/historical/sync-latest", async (req, res) => {
    try {
        const accessToken = await authService.loadAccessToken();
        if (!accessToken) {
            return res.status(401).json({ success: false, message: "Not authenticated with Zerodha" });
        }

        const result = await processDailyEodSync();
        return res.json({
            success: true,
            enqueued: result.enqueued,
            message: `Queued ${result.enqueued} companies (day + minute). historicalWorker.js must be running to process them.`,
        });
    } catch (err) {
        console.error("Sync-latest error:", err);
        return res.status(500).json({ success: false, message: err.message || "Unable to queue sync." });
    }
});

/**
 * Summary of stored historical candles per symbol
 */
router.get("/historical/summary", async (req, res) => {
    try {
        const summaries = await marketService.getStoredHistoricalSummary(50);
        return res.json({ success: true, results: summaries });
    } catch (err) {
        console.error("Summary fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Stored candles for a single symbol
 */
router.get("/historical/stored", async (req, res) => {
    try {
        const { symbol, interval = "day", from, to, exchange = "NSE" } = req.query;

        if (!symbol) {
            return res.status(400).json({ success: false, message: "Symbol is required" });
        }

        const candles = await marketService.getStoredHistoricalPrices(symbol, interval, from, to, exchange);
        return res.json({ success: true, symbol, interval, exchange, results: candles });
    } catch (err) {
        console.error("Stored history fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Ranked companies by a live metric -- gainers, losers, volume, top_bid,
 * top_sell -- for the Dashboard/History "top performers" filters. Reads
 * from Redis's live quote cache (populated continuously by liveTicker's
 * subscribeAllTracked), not Kite directly.
 */
router.get("/movers", async (req, res) => {
    try {
        const { type, exchange, limit } = req.query;

        if (!type) {
            return res.status(400).json({ success: false, message: `type query parameter is required (one of ${moversService.METRICS.join(", ")})` });
        }

        const results = await moversService.getTopMovers({ type, exchange, limit: limit ? Number(limit) : undefined });
        return res.json({ success: true, type, results });
    } catch (err) {
        console.error("Movers fetch error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Companies whose live change_percent falls within [min, max] -- e.g. the
 * dashboard's "3-5% Change" screen. Same Redis-backed live-quote source as
 * /movers, just filtered by a range instead of ranked by a single metric.
 */
router.get("/movers/range", async (req, res) => {
    try {
        const { min, max, exchange, limit } = req.query;

        if (min === undefined || max === undefined) {
            return res.status(400).json({ success: false, message: "min and max query parameters are required" });
        }

        const results = await moversService.getByChangeRange({
            min: Number(min),
            max: Number(max),
            exchange,
            limit: limit ? Number(limit) : undefined,
        });
        return res.json({ success: true, min: Number(min), max: Number(max), results });
    } catch (err) {
        console.error("Movers range fetch error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Tracked companies whose live LTP is at today's upper or lower circuit
 * limit. Live-only (Redis quote cache) -- no historical persistence exists
 * for circuit limits, unlike the gainers/losers snapshot history.
 */
router.get("/movers/circuit", async (req, res) => {
    try {
        const { exchange, type, limit } = req.query;

        const results = await moversService.getCircuitHits({ exchange, type, limit: limit ? Number(limit) : undefined });
        return res.json({ success: true, type: type || "both", results });
    } catch (err) {
        console.error("Circuit hits fetch error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Dates that have a stored daily-movers snapshot, most recent first -- backs
 * the dashboard's day-filter dropdown.
 */
router.get("/movers/history/dates", async (req, res) => {
    try {
        const dates = await dailyMoversService.getAvailableSnapshotDates(30);
        return res.json({ success: true, results: dates.map((d) => d.toISOString().slice(0, 10)) });
    } catch (err) {
        console.error("Movers history dates fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Persisted top gainers/losers/volume/top_bid/top_sell for a past date (see
 * dailyMovers.service.js + jobs/dailyMoversSnapshot.job.js) -- unlike
 * /movers (live, Redis-backed, "right now only"), this reads a stored daily
 * leaderboard so past days can be browsed.
 */
router.get("/movers/history", async (req, res) => {
    try {
        const { date, type, limit } = req.query;

        if (!date) {
            return res.status(400).json({ success: false, message: "date query parameter is required (YYYY-MM-DD)" });
        }
        if (!type) {
            return res.status(400).json({ success: false, message: `type query parameter is required (one of ${dailyMoversService.METRICS.join(", ")})` });
        }

        const results = await dailyMoversService.getDailyMovers(date, type, limit ? Number(limit) : undefined);
        return res.json({ success: true, date, type, results });
    } catch (err) {
        console.error("Movers history fetch error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Most recent depth snapshot timestamp across all symbols -- lets the
 * dashboard show how fresh the captured order-book data is.
 */
router.get("/depth/summary", async (req, res) => {
    try {
        const lastSnapshot = await depthSnapshotService.getLatestSnapshotTimestamp();
        return res.json({ success: true, last_snapshot: lastSnapshot });
    } catch (err) {
        console.error("Depth summary fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Stored depth snapshots for a single symbol -- most recent first, capped at
 * `limit` rows (depth is captured every minute during market hours, so this
 * can add up fast; the caller narrows with from/to for a specific day).
 */
router.get("/depth/stored", async (req, res) => {
    try {
        const { symbol, exchange = "NSE", from, to, limit } = req.query;

        if (!symbol) {
            return res.status(400).json({ success: false, message: "Symbol is required" });
        }

        const snapshots = await depthSnapshotService.getStoredDepthSnapshots(
            symbol,
            exchange,
            from,
            to,
            limit ? Number(limit) : undefined
        );
        return res.json({ success: true, symbol, exchange, results: snapshots });
    } catch (err) {
        console.error("Depth history fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Queue a resumable historical sync for the given symbols. Returns
 * immediately -- the actual Kite fetch + persist happens in the background
 * worker (see backend/historicalWorker.js), not on this request thread.
 */
router.post("/historical/sync", async (req, res) => {
    try {
        const { symbols, exchange = "NSE", interval = "day" } = req.query;

        const accessToken = await authService.loadAccessToken();
        if (!accessToken) {
            return res.status(401).json({ success: false, message: "Not authenticated with Zerodha" });
        }

        if (!symbols) {
            return res.status(400).json({ success: false, message: "symbols query parameter is required" });
        }

        kite.setAccessToken(accessToken);

        const symbolList = symbols.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);

        // Always re-verify every requested symbol against Kite's current
        // instrument dump -- not just the ones missing from `companies` --
        // so a symbol that's been delisted (removed from Zerodha since it
        // was last synced) gets caught and cleaned up too, not just brand-new
        // unknown ones.
        const instruments = await kite.getInstruments(exchange);
        const equityInstruments = Array.isArray(instruments)
            ? instruments.filter((instrument) => instrument.instrument_type === "EQ")
            : [];

        // Exact tradingsymbol match (the common case).
        const exactMap = new Map(
            equityInstruments.map((instrument) => [(instrument.tradingsymbol || "").toUpperCase(), instrument])
        );

        // Many NSE equities trade under a settlement-series suffix (e.g. IVP
        // is actually listed as "IVP-BE", trade-to-trade series) -- a user
        // typing the plain company ticker shouldn't get a false "not found"
        // (or worse, an existing valid row wrongly deleted) just because
        // they didn't include that suffix. Falls back to matching the part
        // before the first hyphen when there's no exact match.
        const baseMap = new Map();
        for (const instrument of equityInstruments) {
            const tradingsymbol = (instrument.tradingsymbol || "").toUpperCase();
            const base = tradingsymbol.split("-")[0];
            if (base && !baseMap.has(base)) {
                baseMap.set(base, instrument);
            }
        }

        const resolved = new Map(); // requested symbol -> matched instrument
        for (const symbol of symbolList) {
            resolved.set(symbol, exactMap.get(symbol) || baseMap.get(symbol) || null);
        }

        const foundSymbols = symbolList.filter((symbol) => resolved.get(symbol));
        const notFoundSymbols = symbolList.filter((symbol) => !resolved.get(symbol));

        // The canonical Zerodha tradingsymbol -- may differ from what the
        // user typed (e.g. "IVP" -> "IVP-BE") -- is what gets stored and
        // queued, so `companies` stays accurate to Zerodha's real listing.
        const canonicalSymbols = foundSymbols.map((symbol) => resolved.get(symbol).tradingsymbol.toUpperCase());

        if (foundSymbols.length > 0) {
            const companiesToUpsert = foundSymbols.map((symbol) => {
                const instrument = resolved.get(symbol);
                return {
                    symbol: instrument.tradingsymbol.toUpperCase(),
                    company_name: instrument.name,
                    exchange,
                    instrument_token: instrument.instrument_token,
                    segment: instrument.segment,
                    exchange_token: instrument.exchange_token,
                };
            });

            await marketService.upsertCompanies(companiesToUpsert);
        }

        // A symbol that no longer exists on Zerodha (under its plain form or
        // any settlement-series suffix) shouldn't keep a stale row (and its
        // historical_prices, via ON DELETE CASCADE) lingering in `companies`
        // -- e.g. it was delisted since it was last synced.
        for (const symbol of notFoundSymbols) {
            await marketService.removeCompany(symbol, exchange);
        }

        if (notFoundSymbols.length === symbolList.length) {
            return res.status(404).json({
                success: false,
                message: `${notFoundSymbols.join(", ")} not found on ${exchange}/Zerodha.`,
            });
        }

        // Queue under the canonical Zerodha tradingsymbol, not necessarily
        // what the user typed -- that's what's now actually stored in
        // `companies` and what the worker/getCompaniesBySymbols look up by.
        for (const symbol of canonicalSymbols) {
            await enqueueSymbolSync(symbol, interval, exchange);
        }

        const resolutionNote = foundSymbols
            .map((symbol) => resolved.get(symbol).tradingsymbol.toUpperCase())
            .some((canonical, i) => canonical !== foundSymbols[i])
            ? ` (resolved to: ${foundSymbols.map((s) => `${s} -> ${resolved.get(s).tradingsymbol.toUpperCase()}`).join(", ")})`
            : "";

        return res.json({
            success: true,
            queued: canonicalSymbols,
            notFound: notFoundSymbols,
            message:
                notFoundSymbols.length > 0
                    ? `Queued ${canonicalSymbols.join(", ")}${resolutionNote}; ${notFoundSymbols.join(", ")} not found on ${exchange}/Zerodha and removed from companies.`
                    : `Historical sync queued; check back shortly.${resolutionNote}`,
        });
    } catch (err) {
        console.error("Sync error:", err);
        return res.status(500).json({ success: false, message: err.message || "Unable to queue historical sync" });
    }
});

module.exports = router;
