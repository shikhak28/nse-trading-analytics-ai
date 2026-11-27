const express = require("express");
const { attachLiveActual } = require("../services/liveActual");
const { attachNextResult } = require("../services/events.service");
const { getBigMovers } = require("../services/bigMovers.service");
const { getUpperCircuits } = require("../services/upperCircuit.service");

const router = express.Router();

const predictionService = require("../services/prediction.service");

/**
 * List predictions, optionally filtered by symbol/exchange/horizon/date.
 */
router.get("/", async (req, res) => {
  try {
    const { symbol, exchange, horizon, date, sector, limit, offset } = req.query;
    const predictions = await predictionService.getPredictions({
      symbol: symbol?.trim() || undefined,
      exchange: exchange?.trim() || undefined,
      horizon: horizon?.trim() || undefined,
      date: date?.trim() || undefined,
      sector: sector?.trim() || undefined,
      limit,
      offset,
    });
    return res.json({ success: true, results: await attachNextResult(await attachLiveActual(predictions)) });
  } catch (err) {
    console.error("Predictions fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Distinct sector names present in companies -- backs the Predictions page's
 * sector filter dropdown. Registered before "/:id" so "sectors" isn't
 * swallowed as an :id value.
 */
router.get("/sectors", async (req, res) => {
  try {
    const sectors = await predictionService.getSectors();
    return res.json({ success: true, results: sectors });
  } catch (err) {
    console.error("Sectors fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * One row per stock for the Price Group page (see getPriceGroupStocks).
 * Registered before "/:id" for the same reason as /sectors.
 */
router.get("/price-groups", async (req, res) => {
  const date = req.query.date?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: "date (YYYY-MM-DD) is required" });
  }
  try {
    const stocks = await predictionService.getPriceGroupStocks({ date });
    return res.json({ success: true, results: await attachNextResult(await attachLiveActual(stocks)) });
  } catch (err) {
    console.error("Price group fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Stocks that rose 5-20% the day after `day`'s prediction, with the model's
 * view of them (see bigMovers.service.js). Registered before "/:id".
 */
router.get("/big-movers", async (req, res) => {
  const day = req.query.day?.trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return res.status(400).json({ success: false, message: "day must be YYYY-MM-DD" });
  }
  try {
    return res.json({ success: true, ...(await getBigMovers({ day })) });
  } catch (err) {
    console.error("Big movers fetch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Stocks that rose 5-10%, 10-20% or 20%+ in a day, ?from=&to= (default the
 * last 10 trading days), flagged if locked at an upper circuit, with what the model said the
 * evening before (see upperCircuit.service.js).
 */
router.get("/upper-circuit", async (req, res) => {
  const { from, to } = req.query;
  const isDay = (d) => d == null || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDay(from) || !isDay(to)) return res.status(400).json({ success: false, message: "from/to must be YYYY-MM-DD" });
  try {
    return res.json({ success: true, ...(await getUpperCircuits({ from, to })) });
  } catch (err) {
    console.error("Upper circuit fetch error:", err);
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
