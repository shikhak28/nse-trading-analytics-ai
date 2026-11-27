const crypto = require("crypto");
const express = require("express");
const { isOwner } = require("../middleware/session");
const { getTopPicksHistory } = require("../services/topPicks.service");

const router = express.Router();

// Read-only pages the owner can share with someone who has no login: a
// request passes with the owner's session or with ?k=<CLIENT_SHARE_KEY>.
// With no CLIENT_SHARE_KEY set, only the owner gets in.
function keyMatches(given) {
    const expected = process.env.CLIENT_SHARE_KEY;
    if (!expected || typeof given !== "string") return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireShareAccess(req, res, next) {
    if (isOwner(req) || keyMatches(req.query.k)) return next();
    return res.status(401).json({ success: false, message: "This link is not valid." });
}

router.get("/top-picks", requireShareAccess, async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 10, 1), 30);
        return res.json({ success: true, results: await getTopPicksHistory({ days }) });
    } catch (err) {
        console.error("Top picks history error:", err);
        return res.status(500).json({ success: false, message: "Could not load the report." });
    }
});

module.exports = router;
