const express = require("express");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * Aggregated prediction accuracy (hit rate, mean error, mean realized
 * return) grouped by day or month, optionally filtered by horizon/target.
 */
router.get("/", async (req, res) => {
  try {
    const { groupBy, horizon, targetLabel } = req.query;
    const accuracy = await predictionService.getAccuracy({
      groupBy: groupBy?.trim() || undefined,
      horizon: horizon?.trim() || undefined,
      targetLabel: targetLabel?.trim() || undefined,
    });
    return res.json({ success: true, results: accuracy });
  } catch (err) {
    console.error("Accuracy fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
