const crypto = require("crypto");
const db = require("../config/db");
const { readPdfAsJson } = require("./gemini");
const { getPriceGroupStocks } = require("./prediction.service");

// Reads a company's results PDF with Gemini and explains it in simple
// Hinglish, next to what our model says about the stock. Each reading is
// stored (financial_reports) so the same PDF is never sent twice and the
// numbers can later feed the model.

const num = { type: "NUMBER", nullable: true };
const SCHEMA = {
    type: "OBJECT",
    properties: {
        company: { type: "STRING" },
        period_label: { type: "STRING", description: "The period as written, e.g. 'Quarter ended 30 Sep 2026'" },
        period_end: { type: "STRING", nullable: true, description: "Last day of the period, YYYY-MM-DD" },
        consolidated: { type: "BOOLEAN", nullable: true, description: "True if these are consolidated figures" },
        unit: { type: "STRING", description: "Unit of the money figures, e.g. '₹ crore' or '₹ lakh'" },
        revenue: { ...num, description: "Revenue from operations, this period" },
        revenue_prev_year: { ...num, description: "Revenue from operations, same period last year" },
        revenue_prev_quarter: { ...num, description: "Revenue from operations, previous quarter" },
        net_profit: { ...num, description: "Net profit after tax (attributable to owners if given), this period" },
        net_profit_prev_year: { ...num, description: "Net profit after tax, same period last year" },
        net_profit_prev_quarter: { ...num, description: "Net profit after tax, previous quarter" },
        eps: { ...num, description: "Basic EPS in rupees, this period" },
        eps_prev_year: { ...num, description: "Basic EPS in rupees, same period last year" },
        operating_margin_pct: { ...num, description: "EBITDA or operating profit as % of revenue, this period" },
        operating_margin_prev_year_pct: { ...num, description: "Same margin, same period last year" },
        summary: { type: "STRING", description: "2-3 short sentences in simple Hinglish (Roman script)" },
        good_points: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 4 short points, simple Hinglish" },
        concerns: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 4 short points, simple Hinglish" },
        verdict: { type: "STRING", enum: ["strong", "mixed", "weak"] },
        verdict_reason: { type: "STRING", description: "One short sentence, simple Hinglish" },
    },
    required: ["company", "period_label", "unit", "summary", "good_points", "concerns", "verdict", "verdict_reason"],
};

function prompt(company, modelView) {
    return [
        `This PDF is a financial results filing of ${company.company_name} (NSE: ${company.symbol}).`,
        "Read it and fill in the JSON. Rules:",
        "- Take numbers exactly from the report's tables. Prefer consolidated figures if both are given. Leave a number null if it is not in the report; never guess.",
        "- All money figures in the single unit you report in `unit`.",
        "- Write summary, good_points, concerns and verdict_reason in very simple Hinglish (Hindi in Roman script mixed with easy English words), short sentences, for someone who is not a finance expert. Mention growth versus last year in %.",
        "- verdict: strong = sales and profit both grew well; weak = profit fell or a loss; mixed = in between.",
        "- Do not give buy or sell advice.",
        modelView
            ? `For context only (do not copy into the numbers): our price model's latest view of this stock is: expected next-day move ${modelView.expected}%, chance of rising 2%+ ${modelView.chanceUp2}%, chance of falling 2%+ ${modelView.chanceDown2}%.`
            : "",
    ].join("\n");
}

const pctChange = (now, before) =>
    now == null || before == null || Number(before) === 0 ? null : Number((((now - before) / Math.abs(before)) * 100).toFixed(1));
const pct = (v) => (v == null ? null : Number((v * 100).toFixed(2)));

async function modelViewFor(symbol) {
    const { rows } = await db.query(
        `SELECT max(predicted_at)::date::text AS day FROM predictions
         WHERE horizon = 'next_day' AND symbol = $1 AND predicted_at >= now() - interval '30 days'`,
        [symbol]
    );
    if (!rows[0]?.day) return null;
    const p = (await getPriceGroupStocks({ date: rows[0].day })).find((s) => s.symbol === symbol);
    if (!p) return null;
    return {
        day: rows[0].day,
        expected: pct(p.expected_return),
        chanceUp2: pct(p.chance_up),
        chanceDown2: pct(p.chance_down),
        signal: p.signal,
        liquid: p.liquid,
    };
}

function present(row, modelView) {
    const r = row.reading;
    return {
        id: row.id,
        symbol: row.symbol,
        fileName: row.file_name,
        createdAt: row.created_at,
        model: row.model,
        reading: r,
        growth: {
            revenueYoY: pctChange(r.revenue, r.revenue_prev_year),
            revenueQoQ: pctChange(r.revenue, r.revenue_prev_quarter),
            profitYoY: pctChange(r.net_profit, r.net_profit_prev_year),
            profitQoQ: pctChange(r.net_profit, r.net_profit_prev_quarter),
            epsYoY: pctChange(r.eps, r.eps_prev_year),
        },
        modelView: modelView ?? null,
    };
}

async function explainReport({ symbol, pdf, fileName }) {
    const sym = String(symbol || "").trim().toUpperCase();
    const { rows: comp } = await db.query(`SELECT symbol, company_name FROM companies WHERE exchange = 'NSE' AND symbol = $1`, [sym]);
    if (!comp.length) throw Object.assign(new Error(`Unknown NSE symbol: ${sym}`), { status: 400 });
    if (!pdf?.length || pdf.subarray(0, 5).toString() !== "%PDF-") {
        throw Object.assign(new Error("Please upload a PDF file."), { status: 400 });
    }

    const sha = crypto.createHash("sha256").update(pdf).digest("hex");
    const modelView = await modelViewFor(sym);
    const { rows: seen } = await db.query(`SELECT * FROM financial_reports WHERE symbol = $1 AND file_sha256 = $2`, [sym, sha]);
    if (seen.length) return { ...present(seen[0], modelView), cached: true };

    const { json: r, model } = await readPdfAsJson({ pdf, prompt: prompt(comp[0], modelView), schema: SCHEMA });
    const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(r.period_end || "") ? r.period_end : null;
    const { rows } = await db.query(
        `INSERT INTO financial_reports
           (symbol, period_label, period_end, consolidated, unit, revenue, revenue_prev_year, net_profit, net_profit_prev_year,
            eps, eps_prev_year, verdict, reading, file_name, file_sha256, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
            sym, r.period_label ?? null, periodEnd, r.consolidated ?? null, r.unit ?? null,
            r.revenue ?? null, r.revenue_prev_year ?? null, r.net_profit ?? null, r.net_profit_prev_year ?? null,
            r.eps ?? null, r.eps_prev_year ?? null, r.verdict ?? null, r, fileName ?? null, sha, model,
        ]
    );
    return { ...present(rows[0], modelView), cached: false };
}

async function listReports({ symbol, limit = 50 } = {}) {
    const { rows } = await db.query(
        `SELECT * FROM financial_reports WHERE ($1::text IS NULL OR symbol = $1) ORDER BY created_at DESC LIMIT $2`,
        [symbol ? String(symbol).toUpperCase() : null, Math.min(Number(limit) || 50, 200)]
    );
    return rows.map((row) => present(row));
}

module.exports = { explainReport, listReports };
