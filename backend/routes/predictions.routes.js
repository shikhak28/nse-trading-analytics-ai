const express = require("express");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * List predictions, optionally filtered by symbol/exchange/horizon/date.
 */
router.get("/", async (req, res) => {
  try {
    const { symbol, exchange, horizon, date, limit, offset } = req.query;
    const predictions = await predictionService.getPredictions({
      symbol: symbol?.trim() || undefined,
      exchange: exchange?.trim() || undefined,
      horizon: horizon?.trim() || undefined,
      date: date?.trim() || undefined,
      limit,
      offset,
    });
    return res.json({ success: true, results: predictions });
  } catch (err) {
    console.error("Predictions fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Single prediction by id, with its explanation payload.
 */
router.get("/:id", async (req, res) => {
  try {
    const prediction = await predictionService.getPredictionById(req.params.id);
    if (!prediction) {
      return res.status(404).json({ success: false, message: "Prediction not found" });
    }
    return res.json({ success: true, result: prediction });
  } catch (err) {
    console.error("Prediction fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
