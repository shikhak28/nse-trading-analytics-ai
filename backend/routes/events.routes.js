const express = require("express");
const eventsService = require("../services/events.service");
const { getPriceGroupStocks } = require("../services/prediction.service");
const { attachLiveActual } = require("../services/liveActual");
const db = require("../config/db");

const router = express.Router();

// Upload: the raw CSV text as the request body (text/csv or text/plain).
router.post("/upload", express.text({ type: ["text/*", "application/csv"], limit: "10mb" }), async (req, res) => {
  try {
    if (typeof req.body !== "string" || !req.body.trim()) {
      return res.status(400).json({ success: false, message: "Send the CSV file contents." });
    }
    const summary = await eventsService.importEventCsv(req.body);
    return res.json({ success: true, ...summary });
  } catch (err) {
    console.error("Event upload error:", err);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Upcoming events, each with the latest model view of the stock.
router.get("/upcoming", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 120);
    const resultsOnly = req.query.all !== "1";
    const [events, status, dayRow] = await Promise.all([
      eventsService.getUpcomingEvents({ days, resultsOnly }),
      eventsService.getUploadStatus(),
      db.query(
        `SELECT to_char(max(predicted_at)::date, 'YYYY-MM-DD') AS day FROM predictions
         WHERE horizon = 'next_day' AND predicted_at >= now() - interval '30 days'`
      ),
    ]);
    const day = dayRow.rows[0]?.day;
    const preds = day ? await attachLiveActual(await getPriceGroupStocks({ date: day })) : [];
    const byKey = new Map(preds.map((p) => [`${p.exchange}:${p.symbol}`, p]));
    const results = events.map((e) => {
      const p = byKey.get(`${e.exchange}:${e.symbol}`);
      return {
        ...e,
        last_close: p?.last_close ?? null,
        last_volume: p?.last_volume ?? null,
        avg_traded_value: p?.avg_traded_value ?? null,
        liquid: p?.liquid ?? false,
        signal: p?.signal ?? null,
        expected_return: p?.expected_return ?? null,
        chance_up: p?.chance_up ?? null,
        chance_down: p?.chance_down ?? null,
        likely_low: p?.likely_low ?? null,
        likely_high: p?.likely_high ?? null,
      };
    });
    return res.json({ success: true, status, predictionDay: day, results });
  } catch (err) {
    console.error("Upcoming events error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
