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

/**
 * Calibration bins (mean predicted vs observed rate) and a confusion matrix
 * at a probability threshold, for one binary target (p_move_up_2pct /
 * p_move_down_2pct). Declared as its own path so it doesn't shadow "/".
 */
router.get("/classification", async (req, res) => {
  try {
    const { horizon, targetLabel, bins, threshold } = req.query;
    const metrics = await predictionService.getClassificationMetrics({
      horizon: horizon?.trim() || undefined,
      targetLabel: targetLabel?.trim(),
      bins,
      threshold,
    });
    return res.json({ success: true, results: metrics });
  } catch (err) {
    console.error("Classification metrics error:", err);
    const status = err.message.startsWith("targetLabel must be") ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
});

module.exports = router;
