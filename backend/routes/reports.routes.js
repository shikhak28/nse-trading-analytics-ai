const express = require("express");
const { explainReport, listReports, reportFile } = require("../services/financialReports.service");

const router = express.Router();

/**
 * Explain a results filing: PDF, NSE XBRL (.xml) or iXBRL page (.html). The
 * body is the raw file, so the global JSON parser leaves it alone.
 *   POST /api/reports/explain?symbol=TCS&name=tcs-q2.pdf
 */
const DOC_TYPES = ["application/pdf", "application/xml", "text/xml", "text/html", "application/xhtml+xml", "application/octet-stream"];
router.post("/explain", express.raw({ type: DOC_TYPES, limit: "20mb" }), async (req, res) => {
  try {
    const result = await explainReport({ symbol: req.query.symbol, pdf: req.body, fileName: req.query.name, lang: req.query.lang });
    return res.json({ success: true, result });
  } catch (err) {
    if (!err.status) console.error("Report explain error:", err);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/** The original uploaded file of a reading, as a download. */
router.get("/:id/file", async (req, res) => {
  try {
    const file = await reportFile(req.params.id);
    if (!file) return res.status(404).json({ success: false, message: "File not kept for this reading." });
    return res.download(file.path, file.name);
  } catch (err) {
    console.error("Report file error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** Past readings, newest first; ?symbol= to filter (prefix match). */
router.get("/", async (req, res) => {
  try {
    return res.json({ success: true, results: await listReports({ symbol: req.query.symbol?.trim() || undefined }) });
  } catch (err) {
    console.error("Reports list error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
