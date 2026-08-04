import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
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
              <div
                key={`${row.exchange}-${row.symbol}`}
                className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2"
              >
                <div>
                  <div className="text-xs font-medium">{row.symbol}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{row.exchange}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
                  {arrow} {formatPercent(row.predicted_value)}
                </span>
              </div>
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

  useEffect(() => {
    const loadPredictions = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getPredictions({ horizon: "next_day", date, limit: 10000 });
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
  }, [date]);

  const rankedRising = useMemo(
    () =>
      predictions
        .filter((row) => row.target_label === "p_move_up_2pct")
        .sort((a, b) => Number(b.predicted_value) - Number(a.predicted_value)),
    [predictions]
  );

  const rankedFalling = useMemo(
    () =>
      predictions
        .filter((row) => row.target_label === "p_move_down_2pct")
        .sort((a, b) => Number(b.predicted_value) - Number(a.predicted_value)),
    [predictions]
  );

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Predictions</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Companies most likely to move ≥2% tomorrow, by model probability.
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

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          />
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
      ) : mode === "topN" ? (
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
    </div>
  );
}

export default Predictions;
