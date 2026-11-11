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

/**
 * Expected-move model performance per price group, from a given date.
 */
router.get("/price-groups", async (req, res) => {
  try {
    const from = req.query.from?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "")) {
      return res.status(400).json({ success: false, message: "from must be YYYY-MM-DD" });
    }
    const performance = await predictionService.getPriceGroupPerformance({ from });
    return res.json({ success: true, results: performance });
  } catch (err) {
    console.error("Price group performance error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Report card for the Price Groups Signal column (see getSignalAccuracy).
 */
router.get("/signals", async (req, res) => {
  try {
    const report = await predictionService.getSignalAccuracy();
    return res.json({ success: true, results: report });
  } catch (err) {
    console.error("Signal accuracy error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
