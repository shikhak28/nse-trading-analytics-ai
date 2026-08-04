import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

const PAGE_SIZE = 20;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function PredictionList({ title, rows, badgeClass, arrow }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Reset to page 1 whenever the underlying list changes (new date, etc.)
  // otherwise a stale page index can point past the end of a shorter list.
  useEffect(() => {
    setPage(0);
  }, [rows]);

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">{title}</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} companies</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No predictions for this date yet.</div>
      ) : (
        <>
          <div className="space-y-2">
            {pageRows.map((row) => (
              <div
                key={`${row.exchange}-${row.symbol}`}
                className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{row.symbol}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{row.exchange}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${badgeClass}`}>
                  {arrow} {formatPercent(row.predicted_value)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
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
              className="rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Predictions() {
  const [date, setDate] = useState(todayIso());
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

  const rising = useMemo(
    () =>
      predictions
        .filter((row) => row.target_label === "p_move_up_2pct")
        .sort((a, b) => Number(b.predicted_value) - Number(a.predicted_value)),
    [predictions]
  );

  const falling = useMemo(
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

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
        />
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PredictionList
            title="Likely to Rise ≥2%"
            rows={rising}
            arrow="▲"
            badgeClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          />
          <PredictionList
            title="Likely to Fall ≥2%"
            rows={falling}
            arrow="▼"
            badgeClass="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
          />
        </div>
      )}
    </div>
  );
}

export default Predictions;
