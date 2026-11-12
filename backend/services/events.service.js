const db = require("../config/db");

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Minimal CSV reader: quoted fields, "" escapes, CRLF, BOM.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// "13-Nov-2026", "13 Nov 2026", "13-11-2026", "13/11/2026", "2026-11-13".
function parseDate(value) {
  const v = (value || "").trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2] - 1, +m[3]);
  m = v.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()] != null) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return iso(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== d ? null : dt.toISOString().slice(0, 10);
}

// Header names vary a little between NSE downloads; match loosely.
const COLUMN_HINTS = {
  symbol: ["symbol"],
  company: ["company", "companyname", "securityname", "name"],
  purpose: ["purpose", "subject"],
  details: ["details", "description", "bmdesc"],
  date: ["date", "meetingdate", "bmdate", "eventdate"],
};

function findColumns(header) {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const cols = {};
  for (const [key, hints] of Object.entries(COLUMN_HINTS)) {
    const idx = norm.findIndex((h) => hints.includes(h));
    cols[key] = idx >= 0 ? idx : norm.findIndex((h) => hints.some((hint) => h.includes(hint)));
  }
  return cols;
}

const RESULTS_RE = /result/i;

/**
 * Loads an NSE Event Calendar CSV. Rows are matched to tracked companies by
 * symbol (also trying the -BE/-SM series); unknown symbols are reported,
 * not stored. Re-uploading the same file is safe (upsert).
 */
async function importEventCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file has no data rows.");
  const cols = findColumns(rows[0]);
  for (const key of ["symbol", "purpose", "date"]) {
    if (cols[key] < 0) {
      throw new Error(`Could not find a "${key}" column. Upload the NSE Event Calendar CSV (columns: Symbol, Company, Purpose, Details, Date).`);
    }
  }

  const { rows: companies } = await db.query(`SELECT symbol FROM companies WHERE exchange = 'NSE'`);
  const known = new Set(companies.map((c) => c.symbol));
  const resolve = (sym) => [sym, `${sym}-BE`, `${sym}-SM`, `${sym}-ST`, `${sym}-BZ`].find((s) => known.has(s));

  const events = [];
  const unmatched = new Set();
  let badDates = 0;
  for (const r of rows.slice(1)) {
    const raw = (r[cols.symbol] || "").trim().toUpperCase();
    const date = parseDate(r[cols.date]);
    if (!raw) continue;
    if (!date) {
      badDates++;
      continue;
    }
    const symbol = resolve(raw);
    if (!symbol) {
      unmatched.add(raw);
      continue;
    }
    const purpose = (r[cols.purpose] || "").trim() || "Board Meeting";
    const details = cols.details >= 0 ? (r[cols.details] || "").trim() : "";
    events.push({
      symbol,
      company: cols.company >= 0 ? (r[cols.company] || "").trim() : null,
      purpose,
      details,
      date,
      isResults: RESULTS_RE.test(purpose) || RESULTS_RE.test(details),
    });
  }

  for (let i = 0; i < events.length; i += 500) {
    const chunk = events.slice(i, i + 500);
    const values = [];
    const placeholders = chunk.map((e, j) => {
      values.push(e.symbol, e.company, e.purpose, e.details, e.date, e.isResults);
      const o = j * 6;
      return `('NSE', $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}::date, $${o + 6})`;
    });
    await db.query(
      `INSERT INTO corporate_events (exchange, symbol, company_name, purpose, details, event_date, is_results)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (exchange, symbol, event_date, purpose)
       DO UPDATE SET details = EXCLUDED.details, company_name = EXCLUDED.company_name,
                     is_results = EXCLUDED.is_results, uploaded_at = now()`,
      values
    );
  }

  return {
    stored: events.length,
    results: events.filter((e) => e.isResults).length,
    unmatched: [...unmatched].slice(0, 50),
    unmatchedCount: unmatched.size,
    badDates,
  };
}

// Today in IST, as the calendar dates are IST days.
const TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

async function getUpcomingEvents({ days = 30, resultsOnly = true } = {}) {
  const { rows } = await db.query(
    `SELECT e.exchange, e.symbol, COALESCE(c.company_name, e.company_name) AS company_name,
            e.purpose, e.details, to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
            (e.event_date - ${TODAY_SQL}) AS days_left, e.is_results
     FROM corporate_events e
     LEFT JOIN companies c ON c.exchange = e.exchange AND c.symbol = e.symbol
     WHERE e.event_date >= ${TODAY_SQL} AND e.event_date <= ${TODAY_SQL} + $1::int
       AND ($2::boolean = false OR e.is_results)
     ORDER BY e.event_date, e.symbol`,
    [days, resultsOnly]
  );
  return rows;
}

async function getUploadStatus() {
  const { rows } = await db.query(
    `SELECT max(uploaded_at) AS last_upload,
            (extract(epoch FROM now() - max(uploaded_at)) / 86400)::float8 AS age_days,
            to_char(max(event_date), 'YYYY-MM-DD') AS last_event_date,
            count(*) FILTER (WHERE event_date >= ${TODAY_SQL})::int AS upcoming
     FROM corporate_events`
  );
  return rows[0];
}

/**
 * Adds next_result_date / next_result_days (within 30 days) to each row
 * that has exchange + symbol, for the "RESULT" tag on the stock pages.
 */
async function attachNextResult(rows) {
  if (!rows.length) return rows;
  const { rows: events } = await db.query(
    `SELECT DISTINCT ON (exchange, symbol) exchange, symbol,
            to_char(event_date, 'YYYY-MM-DD') AS event_date, (event_date - ${TODAY_SQL}) AS days_left
     FROM corporate_events
     WHERE is_results AND event_date >= ${TODAY_SQL} AND event_date <= ${TODAY_SQL} + 30
     ORDER BY exchange, symbol, event_date`
  );
  if (!events.length) return rows;
  const next = new Map(events.map((e) => [`${e.exchange}:${e.symbol}`, e]));
  return rows.map((r) => {
    const e = next.get(`${r.exchange}:${r.symbol}`);
    return e ? { ...r, next_result_date: e.event_date, next_result_days: e.days_left } : r;
  });
}

module.exports = { importEventCsv, getUpcomingEvents, getUploadStatus, attachNextResult, parseCsv, parseDate };
