import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";
import nseHolidays from "../../../shared/nse_holidays.json";

const PAGE_SIZE = 20;
const TIER_PAGE_SIZE = 10;
const TOP_N = 20;

// Every tracked company gets scored for both questions independently (is it
// likely to rise, is it likely to fall) -- these aren't mutually exclusive
// buckets, so without narrowing down, both lists would just be the full
// universe re-sorted.
//
// Two views: "topN" (always the N highest-probability names, matching the
// ranking methodology the model was actually validated under -- see
// evaluate.top_decile_backtest in training/) or "tiers" (split by confidence
// band, since a single hard threshold like >=50% is almost never crossed --
// this domain's signal is real but modest, see the IC discussion). Bands are
// non-overlapping; the last one catches anything unusually high-confidence
// that would otherwise be silently excluded.
const CONFIDENCE_TIERS = [
  { label: "3-5%", min: 0.03, max: 0.05 },
  { label: "5-10%", min: 0.05, max: 0.10 },
  { label: "10-15%", min: 0.10, max: 0.15 },
  { label: "15-30%", min: 0.15, max: 0.30 },
  { label: "30%+", min: 0.30, max: Infinity },
];

// Sections by last close (₹). min is inclusive, max exclusive. Stocks with no
// recent close have no known band, so they only appear under "All".
const PRICE_BANDS = [
  { key: "penny", label: "Penny", range: "under ₹500", min: 0, max: 500 },
  { key: "mid", label: "Mid", range: "₹500–5,000", min: 500, max: 5000 },
  { key: "upper", label: "Upper", range: "₹5,000–10,000", min: 5000, max: 10000 },
  { key: "high_risk", label: "High Risk", range: "₹10,000+", min: 10000, max: Infinity },
];

function matchesBand(row, band) {
  if (!band) return true;
  if (row.last_close === null || row.last_close === undefined) return false;
  const price = Number(row.last_close);
  return price >= band.min && price < band.max;
}

// Local (not UTC) YYYY-MM-DD -- toISOString() would roll back to the
// previous day in IST before 5:30 AM.
function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

// Same holiday list the cron's trading_calendar.py guard reads.
const NSE_HOLIDAYS = new Set(
  Object.entries(nseHolidays)
    .filter(([key]) => !key.startsWith("_"))
    .flatMap(([, days]) => days)
);

function isTradingDay(d) {
  return d.getDay() !== 0 && d.getDay() !== 6 && !NSE_HOLIDAYS.has(toIsoDate(d));
}

// The date picker is the trading day being *predicted*; predict.py runs at
// 6 PM on the previous trading day, so that's the predicted_at date to query.
// Skips weekends and NSE holidays (e.g. Monday -> Friday).
function previousTradingDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  do {
    d.setDate(d.getDate() - 1);
  } while (!isTradingDay(d));
  return toIsoDate(d);
}

function formatDay(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function matchesSearch(row, search) {
  if (!search) return true;
  const needle = search.trim().toLowerCase();
  return (
    row.symbol?.toLowerCase().includes(needle) ||
    row.company_name?.toLowerCase().includes(needle)
  );
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function PredictionRow({ row, badgeClass, arrow }) {
  const [expanded, setExpanded] = useState(false);
  const topFeatures = row.explanation?.topFeatures;

  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium">{row.symbol}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {row.exchange}
            {row.last_close !== null && row.last_close !== undefined &&
              ` · ₹${Number(row.last_close).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {topFeatures?.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Why?"
            >
              ⓘ Why
            </button>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
            {arrow} {formatPercent(row.predicted_value)}
          </span>
        </div>
      </div>

      {expanded && topFeatures?.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-slate-200 dark:border-slate-700 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
          {topFeatures.map((f) => (
            <li key={f.feature}>• {f.phrase}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PredictionList({ title, rows, badgeClass, arrow, pageSize = PAGE_SIZE }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  // Reset to page 1 whenever the underlying list changes (new date, mode,
  // tier, etc.) otherwise a stale page index can point past a shorter list.
  useEffect(() => {
    setPage(0);
  }, [rows]);

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{rows.length} companies</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No companies in this range.</div>
      ) : (
        <>
          <div className="space-y-1.5">
            {pageRows.map((row) => (
              <PredictionRow key={`${row.exchange}-${row.symbol}`} row={row} badgeClass={badgeClass} arrow={arrow} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="text-slate-500 dark:text-slate-400">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TierSection({ title, rankedRows, badgeClass, arrow }) {
  return (
    <div>
      <h2 className="mb-3 text-base font-medium">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {CONFIDENCE_TIERS.map((tier) => {
          const rows = rankedRows.filter(
            (row) => Number(row.predicted_value) >= tier.min && Number(row.predicted_value) < tier.max
          );
          return (
            <PredictionList
              key={tier.label}
              title={tier.label}
              rows={rows}
              badgeClass={badgeClass}
              arrow={arrow}
              pageSize={TIER_PAGE_SIZE}
            />
          );
        })}
      </div>
    </div>
  );
}

function Predictions() {
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState("topN");
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sectors, setSectors] = useState([]);
  const [sector, setSector] = useState("");
  const [search, setSearch] = useState("");
  const [bandKey, setBandKey] = useState("all");

  const madeOn = previousTradingDay(date);

  useEffect(() => {
    predictionsApi
      .getSectors()
      .then((data) => setSectors(data.success ? data.results : []))
      .catch(() => setSectors([]));
  }, []);

  useEffect(() => {
    const loadPredictions = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getPredictions({
          horizon: "next_day",
          date: madeOn,
          sector: sector || undefined,
          limit: 10000,
        });
        if (data.success) {
          setPredictions(data.results);
          setError(null);
        } else {
          setError(data.message || "Unable to load predictions.");
        }
      } catch (err) {
        setError(err.message || "Unable to load predictions.");
      } finally {
        setLoading(false);
      }
    };

    loadPredictions();
  }, [madeOn, sector]);

  const searched = useMemo(
    () => predictions.filter((row) => matchesSearch(row, search)),
    [predictions, search]
  );

  // Every list is ranked inside the selected band, so "Top 20" means the top
  // 20 of that band rather than the slice of the overall top 20 that fits it.
  const { rankedRising, rankedFalling, expectedGainers, expectedLosers } = useMemo(() => {
    const band = PRICE_BANDS.find((b) => b.key === bandKey);
    const rank = (label, direction) =>
      searched
        .filter((row) => row.target_label === label && matchesBand(row, band))
        .sort((a, b) => direction * (Number(b.predicted_value) - Number(a.predicted_value)));
    return {
      rankedRising: rank("p_move_up_2pct", 1),
      rankedFalling: rank("p_move_down_2pct", 1),
      expectedGainers: rank("next_day_return", 1).slice(0, TOP_N),
      expectedLosers: rank("next_day_return", -1).slice(0, TOP_N),
    };
  }, [searched, bandKey]);

  // One target only, so each company counts once rather than once per model.
  const bandCounts = useMemo(() => {
    const companies = searched.filter((row) => row.target_label === "p_move_up_2pct");
    return {
      all: companies.length,
      ...Object.fromEntries(
        PRICE_BANDS.map((band) => [band.key, companies.filter((row) => matchesBand(row, band)).length])
      ),
    };
  }, [searched]);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Predictions</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Companies most likely to move ≥2% on <span className="font-medium text-slate-700 dark:text-slate-200">{formatDay(date)}</span>,
            by model probability (predicted after market close on {formatDay(madeOn)}).
            {!isTradingDay(new Date(`${date}T00:00:00`)) && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                {formatDay(date)} is a market holiday -- no trading that day.
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setMode("topN")}
              className={`px-4 py-2 ${
                mode === "topN"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
              }`}
            >
              Top {TOP_N}
            </button>
            <button
              type="button"
              onClick={() => setMode("tiers")}
              className={`px-4 py-2 ${
                mode === "tiers"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
              }`}
            >
              Confidence Tiers
            </button>
          </div>

          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          >
            <option value="">All Sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or company..."
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm w-56"
          />

          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Predictions for
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {[{ key: "all", label: "All" }, ...PRICE_BANDS].map((band) => (
          <button
            key={band.key}
            type="button"
            onClick={() => setBandKey(band.key)}
            className={`rounded-full border px-4 py-2 text-sm ${
              bandKey === band.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
            }`}
          >
            <span className="font-medium">{band.label}</span>
            {band.range && <span className="ml-1.5 opacity-75">{band.range}</span>}
            <span className="ml-1.5 opacity-75">({bandCounts[band.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading predictions...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <>
          {mode === "topN" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PredictionList
                title="Likely to Rise ≥2%"
                rows={rankedRising.slice(0, TOP_N)}
                arrow="▲"
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <PredictionList
                title="Likely to Fall ≥2%"
                rows={rankedFalling.slice(0, TOP_N)}
                arrow="▼"
                badgeClass="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              />
            </div>
          ) : (
            <div className="space-y-8">
              <TierSection
                title="Likely to Rise ≥2% -- by confidence"
                rankedRows={rankedRising}
                arrow="▲"
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <TierSection
                title="Likely to Fall ≥2% -- by confidence"
                rankedRows={rankedFalling}
                arrow="▼"
                badgeClass="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              />
            </div>
          )}

          <div className="mt-8">
            <h2 className="mb-3 text-base font-medium">Biggest Expected Movers (by predicted % move)</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PredictionList
                title="Expected Gainers"
                rows={expectedGainers}
                arrow="▲"
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <PredictionList
                title="Expected Losers"
                rows={expectedLosers}
                arrow="▼"
                badgeClass="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Predictions;
