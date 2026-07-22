const express = require("express");

const router = express.Router();

const authService = require("../services/auth.service");
const userService = require("../services/user.service");
const gttRulesService = require("../services/gttRules.service");
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
 * Modifies an active GTT (e.g. changing trigger price(s) or order legs).
 * Same "frontend already confirmed" assumption as POST /.
 */
router.put("/:triggerId", async (req, res) => {
    try {
        const { exchange, tradingsymbol, trigger_type, trigger_values, last_price, orders } = req.body;

        if (!exchange || !tradingsymbol || !trigger_type || !trigger_values || !last_price || !orders) {
            return res.status(400).json({
                success: false,
                message: "exchange, tradingsymbol, trigger_type, trigger_values, last_price, and orders are all required",
            });
        }

        const result = await kite.modifyGTT(req.params.triggerId, { exchange, tradingsymbol, trigger_type, trigger_values, last_price, orders });
        return res.json({ success: true, result });
    } catch (err) {
        console.error("GTT modify error:", err);
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

/**
 * Saved GTT rule templates -- local data only, never touches Kite. Scoped
 * to the single account owner row (see user.service.js -- this app is
 * single-tenant, `users` normally holds exactly one row).
 */
router.get("/rules", async (req, res) => {
    try {
        const user = await userService.getUser();
        const rules = await gttRulesService.listRules(user.id);
        return res.json({ success: true, results: rules });
    } catch (err) {
        console.error("GTT rules fetch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/rules", async (req, res) => {
    try {
        const { name, transaction_type } = req.body;
        if (!name || !transaction_type) {
            return res.status(400).json({ success: false, message: "name and transaction_type are required" });
        }

        const user = await userService.getUser();
        const rule = await gttRulesService.createRule(user.id, req.body);
        return res.json({ success: true, result: rule });
    } catch (err) {
        console.error("GTT rule create error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.put("/rules/:id", async (req, res) => {
    try {
        const rule = await gttRulesService.updateRule(req.params.id, req.body);
        return res.json({ success: true, result: rule });
    } catch (err) {
        console.error("GTT rule update error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.delete("/rules/:id", async (req, res) => {
    try {
        await gttRulesService.deleteRule(req.params.id);
        return res.json({ success: true });
    } catch (err) {
        console.error("GTT rule delete error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
