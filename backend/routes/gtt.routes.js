const express = require("express");

const router = express.Router();

const authService = require("../services/auth.service");
const kite = require("../config/kite");

/**
 * Same pattern as portfolio.routes.js -- every route here needs a live
 * Zerodha session.
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
 * All GTTs currently active on the account.
 */
router.get("/", async (req, res) => {
    try {
        const results = await kite.getGTTs();
        return res.json({ success: true, results });
    } catch (err) {
        console.error("GTT list fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Places a real GTT order on the user's live Zerodha account. The frontend
 * is expected to have already shown an explicit confirm step before this is
 * ever called -- there's no additional confirmation here, this executes
 * immediately.
 */
router.post("/", async (req, res) => {
    try {
        const { exchange, tradingsymbol, trigger_type, trigger_values, last_price, orders } = req.body;

        if (!exchange || !tradingsymbol || !trigger_type || !trigger_values || !last_price || !orders) {
            return res.status(400).json({
                success: false,
                message: "exchange, tradingsymbol, trigger_type, trigger_values, last_price, and orders are all required",
            });
        }

        const result = await kite.placeGTT({ exchange, tradingsymbol, trigger_type, trigger_values, last_price, orders });
        return res.json({ success: true, result });
    } catch (err) {
        console.error("GTT place error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * Cancels an active GTT.
 */
router.delete("/:triggerId", async (req, res) => {
    try {
        const result = await kite.deleteGTT(req.params.triggerId);
        return res.json({ success: true, result });
    } catch (err) {
        console.error("GTT delete error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
