const express = require("express");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * Verified prediction outcomes, optionally filtered by symbol/checkpoint/date range.
 */
router.get("/", async (req, res) => {
  try {
    const { symbol, exchange, checkpoint, from, to, limit, offset } = req.query;
    const verifications = await predictionService.getVerification({
      symbol: symbol?.trim() || undefined,
      exchange: exchange?.trim() || undefined,
      checkpoint: checkpoint?.trim() || undefined,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      limit,
      offset,
    });
    return res.json({ success: true, results: verifications });
  } catch (err) {
    console.error("Verification fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
