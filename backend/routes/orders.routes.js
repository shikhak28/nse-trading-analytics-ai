const express = require("express");

const router = express.Router();

const authService = require("../services/auth.service");
const kite = require("../config/kite");

/**
 * Same pattern as portfolio.routes.js / gtt.routes.js -- every route here
 * needs a live Zerodha session. Orders are a distinct Kite API domain from
 * GTTs -- a GTT firing places a real order here, but cancelling that order
 * is a separate call from cancelling the GTT itself.
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
 * All orders for the day (any status -- open, complete, cancelled, rejected).
 */
router.get("/", async (req, res) => {
    try {
        const results = await kite.getOrders();
        return res.json({ success: true, results });
    } catch (err) {
        console.error("Orders fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Cancels a pending order. The frontend is expected to have already shown
 * an explicit confirm step before this is ever called.
 */
router.delete("/:variety/:orderId", async (req, res) => {
    try {
        const result = await kite.cancelOrder(req.params.variety, req.params.orderId);
        return res.json({ success: true, result });
    } catch (err) {
        console.error("Order cancel error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
