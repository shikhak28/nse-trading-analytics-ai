const express = require("express");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * Persisted daily rankings by category, optionally filtered by date.
 */
router.get("/", async (req, res) => {
  try {
    const { date, category } = req.query;
    const rankings = await predictionService.getRankings({
      date: date?.trim() || undefined,
      category: category?.trim() || undefined,
    });
    return res.json({ success: true, results: rankings });
  } catch (err) {
    console.error("Rankings fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
