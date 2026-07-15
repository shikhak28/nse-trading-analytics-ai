const express = require("express");

const router = express.Router();

const marketService = require("../services/market.service");
const depthSnapshotService = require("../services/depthSnapshot.service");
const moversService = require("../services/movers.service");
const authService = require("../services/auth.service");
const kite = require("../config/kite");
const { enqueueSymbolSync } = require("../queues");

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

        // Make sure every requested symbol has a companies row (with an
        // instrument_token) before queuing -- the worker looks it up there
        // rather than re-fetching Kite's full instrument dump per symbol.
        const existing = await marketService.getCompaniesBySymbols(symbolList, exchange);
        const knownSymbols = new Set(existing.map((company) => company.symbol));
        const missingSymbols = symbolList.filter((symbol) => !knownSymbols.has(symbol));

        if (missingSymbols.length > 0) {
            const instruments = await kite.getInstruments(exchange);
            const instrumentMap = Array.isArray(instruments)
                ? instruments.reduce((map, instrument) => {
                      const symbolKey = (instrument.tradingsymbol || instrument.trading_symbol || "").toUpperCase();
                      map[symbolKey] = instrument;
                      return map;
                  }, {})
                : {};

            const companiesToUpsert = missingSymbols.map((symbol) => {
                const instrument = instrumentMap[symbol];
                return {
                    symbol,
                    company_name: instrument?.name || symbol,
                    exchange,
                    instrument_token: instrument?.instrument_token || symbol,
                    segment: instrument?.segment || "",
                    exchange_token: instrument?.exchange_token || "",
                };
            });

            await marketService.upsertCompanies(companiesToUpsert);
        }

        for (const symbol of symbolList) {
            await enqueueSymbolSync(symbol, interval, exchange);
        }

        return res.json({
            success: true,
            queued: symbolList,
            message: "Historical sync queued; check back shortly.",
        });
    } catch (err) {
        console.error("Sync error:", err);
        return res.status(500).json({ success: false, message: err.message || "Unable to queue historical sync" });
    }
});

module.exports = router;
