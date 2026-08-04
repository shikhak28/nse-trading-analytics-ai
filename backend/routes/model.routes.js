const express = require("express");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * Current production model(s), optionally filtered by horizon.
 */
router.get("/", async (req, res) => {
  try {
    const { horizon } = req.query;
    const models = await predictionService.getCurrentModel(horizon?.trim() || undefined);
    return res.json({ success: true, results: models });
  } catch (err) {
    console.error("Model fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Full version history, optionally filtered by horizon.
 */
router.get("/versions", async (req, res) => {
  try {
    const { horizon } = req.query;
    const versions = await predictionService.getModelVersions(horizon?.trim() || undefined);
    return res.json({ success: true, results: versions });
  } catch (err) {
    console.error("Model versions fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
