const express = require("express");

const router = express.Router();

const authService = require("../services/auth.service");
const kite = require("../config/kite");

/**
 * Every route here needs a live Zerodha session -- loads the token and sets
 * it on the shared kite client before falling through to the handler.
 */
async function requireAuth(req, res, next) {
    const accessToken = await authService.loadAccessToken();
    if (!accessToken) {
        return res.status(401).json({ success: false, message: "Not authenticated with Zerodha" });
    }
    kite.setAccessToken(accessToken);
    next();
}

router.use(requireAuth);

/**
 * Long-term equity holdings, with Kite's own up-to-date P&L computation.
 */
router.get("/holdings", async (req, res) => {
    try {
        const holdings = await kite.getHoldings();
        return res.json({ success: true, results: holdings });
    } catch (err) {
        console.error("Holdings fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Short-term (day/overnight) open positions.
 */
router.get("/positions", async (req, res) => {
    try {
        const positions = await kite.getPositions();
        return res.json({ success: true, results: positions });
    } catch (err) {
        console.error("Positions fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Instruments currently under auction, if any -- most days this is empty.
 */
router.get("/holdings/auctions", async (req, res) => {
    try {
        const auctions = await kite.getAuctionInstruments();
        return res.json({ success: true, results: auctions });
    } catch (err) {
        console.error("Auctions fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Convert an open position's margin product (e.g. MIS -> CNC). Exposed as
 * POST on our own route (matches this app's convention -- /historical/sync
 * is also a POST for a mutating action); maps to Kite's PUT internally via
 * the SDK regardless.
 */
router.post("/positions/convert", async (req, res) => {
    try {
        const { exchange, tradingsymbol, transaction_type, position_type, quantity, old_product, new_product } = req.body;

        if (!exchange || !tradingsymbol || !transaction_type || !position_type || !quantity || !old_product || !new_product) {
            return res.status(400).json({
                success: false,
                message: "exchange, tradingsymbol, transaction_type, position_type, quantity, old_product, and new_product are all required",
            });
        }

        const result = await kite.convertPosition({
            exchange,
            tradingsymbol,
            transaction_type,
            position_type,
            quantity,
            old_product,
            new_product,
        });
        return res.json({ success: true, result });
    } catch (err) {
        console.error("Position conversion error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
