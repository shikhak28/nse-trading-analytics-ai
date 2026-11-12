import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";
import { formatVolume } from "../utils/volume";
import { formatDay, isTradingDay, previousTradingDay, todayIso } from "../utils/tradingDays";

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

function formatMove(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

// Actual move on the predicted day, with ✓ when it went the predicted way
// (dir 1 = up, -1 = down).
function ActualMove({ row, dir }) {
  if (row.actual_return == null) {
    return <span className="text-[11px] text-slate-400" title="Shows after that day's market close">Waiting</span>;
  }
  const right = Math.sign(row.actual_return) === dir;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs" title={right ? "Moved the predicted way" : "Moved the other way"}>
      <span className="text-[11px] text-slate-400">Actual</span>
      {row.actual_live && <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="Market is open: live price, final after close">LIVE</span>}
      <span className={`font-semibold ${row.actual_return >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
        {formatMove(row.actual_return)}
      </span>
      <span className={`rounded-full px-1.5 text-[11px] font-bold ${right ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}>
        {right ? "✓" : "✗"}
      </span>
    </span>
  );
}

// "12 of 20 went up · 3 hit +2% · avg +0.40%" for a list, once results exist.
function ListScore({ rows, dir }) {
  const done = rows.filter((r) => r.actual_return != null);
  if (done.length === 0) return null;
  const right = done.filter((r) => Math.sign(r.actual_return) === dir).length;
  const hit = done.filter((r) => r.actual_return * dir >= 0.02).length;
  const avg = done.reduce((sum, r) => sum + r.actual_return, 0) / done.length;
  return (
    <div className="mb-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs">
      <span className="font-semibold">
        {right} of {done.length}
      </span>{" "}
      went {dir > 0 ? "up" : "down"} ({Math.round((right / done.length) * 100)}%)
      <span className="text-slate-500 dark:text-slate-400"> · {hit} moved {dir > 0 ? "+" : "−"}2% or more · avg actual </span>
      <span className={avg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{formatMove(avg)}</span>
    </div>
  );
}

function PredictionRow({ row, badgeClass, arrow }) {
  const [expanded, setExpanded] = useState(false);
  const topFeatures = row.explanation?.topFeatures;

  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
      {/* Line 1: stock + model badge. Line 2: expected vs actual. Two lines
          so it still fits the narrow Confidence Tiers columns. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{row.symbol}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {row.exchange}
            {row.last_close !== null && row.last_close !== undefined &&
              ` · ₹${Number(row.last_close).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            {row.last_volume != null && <span title="Shares traded in the last session">{` · Vol ${formatVolume(row.last_volume)}`}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-slate-400">{row.target_label === "next_day_return" ? "Expected" : "Chance"}</span>
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
            {arrow} {formatPercent(row.predicted_value)}
          </span>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {row.target_label !== "next_day_return" && row.expected_return != null && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs" title="Model's expected % move for the day">
              <span className="text-[11px] text-slate-400">Expected</span>
              <span className={`font-semibold ${row.expected_return >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {formatMove(row.expected_return)}
              </span>
            </span>
          )}
          <ActualMove row={row} dir={arrow === "▲" ? 1 : -1} />
        </div>
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

// Reorders a list that's already been chosen by the model (top N / tier).
// Stocks with no actual move yet go last.
function sortRows(rows, sortBy) {
  if (sortBy === "model") return rows;
  const dir = sortBy === "actual_desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.actual_return == null) return b.actual_return == null ? 0 : 1;
    if (b.actual_return == null) return -1;
    return dir * (a.actual_return - b.actual_return);
  });
}

function PredictionList({ title, rows: unsortedRows, badgeClass, arrow, sortBy = "model", pageSize = PAGE_SIZE }) {
  const rows = useMemo(() => sortRows(unsortedRows, sortBy), [unsortedRows, sortBy]);
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
      <ListScore rows={rows} dir={arrow === "▲" ? 1 : -1} />

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

function TierSection({ title, rankedRows, badgeClass, arrow, sortBy }) {
  return (
    <div>
      <h2 className="mb-3 text-base font-medium">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
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
              sortBy={sortBy}
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
  // Hide penny stocks below this last close (0 = show all).
  const [minPrice, setMinPrice] = useState(100);
  const [sortBy, setSortBy] = useState("model");

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

  // While the market is open, actual moves come from live prices: refresh
  // them every minute without the loading spinner.
  const hasLive = predictions.some((row) => row.actual_live);
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(async () => {
      try {
        const data = await predictionsApi.getPredictions({ horizon: "next_day", date: madeOn, sector: sector || undefined, limit: 10000 });
        if (data.success) setPredictions(data.results);
      } catch {
        // keep the last numbers; the next tick retries
      }
    }, 60000);
    return () => clearInterval(id);
  }, [hasLive, madeOn, sector]);

  const { rankedRising, rankedFalling, expectedGainers, expectedLosers } = useMemo(() => {
    // Every row also carries the stock's expected % move (next_day_return),
    // so the chance lists can show expected vs actual side by side.
    const expected = new Map(
      predictions.filter((r) => r.target_label === "next_day_return").map((r) => [`${r.exchange}:${r.symbol}`, Number(r.predicted_value)])
    );
    // A search always shows its matches, even cheap stocks.
    const searching = search.trim() !== "";
    const searched = predictions
      .filter((row) => matchesSearch(row, search))
      .filter((row) => searching || !minPrice || Number(row.last_close) >= minPrice)
      .map((row) => ({ ...row, expected_return: expected.get(`${row.exchange}:${row.symbol}`) ?? null }));
    const rank = (label, direction) =>
      searched
        .filter((row) => row.target_label === label)
        .sort((a, b) => direction * (Number(b.predicted_value) - Number(a.predicted_value)));
    return {
      rankedRising: rank("p_move_up_2pct", 1),
      rankedFalling: rank("p_move_down_2pct", 1),
      expectedGainers: rank("next_day_return", 1).slice(0, TOP_N),
      expectedLosers: rank("next_day_return", -1).slice(0, TOP_N),
    };
  }, [predictions, search, minPrice]);

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

        <div className="flex flex-wrap items-center gap-3">
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

          <select
            value={minPrice}
            onChange={(e) => setMinPrice(Number(e.target.value))}
            aria-label="Hide penny stocks"
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          >
            <option value={0}>All prices</option>
            <option value={20}>Hide under ₹20</option>
            <option value={50}>Hide under ₹50</option>
            <option value={80}>Hide under ₹80</option>
            <option value={100}>Hide under ₹100</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Order by"
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          >
            <option value="model">Order: model rank</option>
            <option value="actual_desc">Order: actual move, highest first</option>
            <option value="actual_asc">Order: actual move, lowest first</option>
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
                sortBy={sortBy}
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <PredictionList
                title="Likely to Fall ≥2%"
                rows={rankedFalling.slice(0, TOP_N)}
                arrow="▼"
                sortBy={sortBy}
                badgeClass="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              />
            </div>
          ) : (
            <div className="space-y-8">
              <TierSection
                title="Likely to Rise ≥2% -- by confidence"
                rankedRows={rankedRising}
                arrow="▲"
                sortBy={sortBy}
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <TierSection
                title="Likely to Fall ≥2% -- by confidence"
                rankedRows={rankedFalling}
                arrow="▼"
                sortBy={sortBy}
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
                sortBy={sortBy}
                badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              />
              <PredictionList
                title="Expected Losers"
                rows={expectedLosers}
                arrow="▼"
                sortBy={sortBy}
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
