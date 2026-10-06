import { useEffect, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

const PAGE_SIZE = 25;

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function Verification() {
  const [checkpoint, setCheckpoint] = useState("next_day");
  const [symbol, setSymbol] = useState("");
  const [debouncedSymbol, setDebouncedSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Debounce the symbol search box so every keystroke doesn't trigger a
  // fresh server round-trip -- this is server-side (unlike Predictions.jsx's
  // client-side search), since getVerification already takes a symbol param
  // and this table can grow large over time.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSymbol(symbol.trim()), 300);
    return () => clearTimeout(timer);
  }, [symbol]);

  useEffect(() => {
    setPage(0);
  }, [checkpoint, debouncedSymbol, from, to]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Fetch one extra row to know whether a "Next" page exists, without
        // a separate count query.
        const data = await predictionsApi.getVerification({
          checkpoint,
          symbol: debouncedSymbol || undefined,
          from: from || undefined,
          to: to || undefined,
          limit: PAGE_SIZE + 1,
          offset: page * PAGE_SIZE,
        });
        if (data.success) {
          setHasMore(data.results.length > PAGE_SIZE);
          setRows(data.results.slice(0, PAGE_SIZE));
          setError(null);
        } else {
          setError(data.message || "Unable to load verification data.");
        }
      } catch (err) {
        setError(err.message || "Unable to load verification data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [checkpoint, debouncedSymbol, from, to, page]);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Verification</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Every prediction's actual outcome -- the real "was it right" record.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setCheckpoint("next_day")}
              className={`px-4 py-2 ${checkpoint === "next_day" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              Next Day
            </button>
            <button
              type="button"
              onClick={() => setCheckpoint("eod")}
              className={`px-4 py-2 ${checkpoint === "eod" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              EOD
            </button>
          </div>

          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Search symbol..."
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm w-44"
          />

          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading verification data...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-sm text-slate-500 dark:text-slate-400">
          No verified predictions match this filter.
        </div>
      ) : (
        <>
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 text-sm">
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Symbol</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Target</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Predicted</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Actual</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Error</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Hit?</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Realized Return</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Checked At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="text-sm">
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70 font-medium">{row.symbol}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{row.target_label}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.predicted_value)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.actual_value)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.error)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">
                      {row.signal_hit ? (
                        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">✗</span>
                      )}
                    </td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.realized_return)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70 text-slate-500 dark:text-slate-400">{formatDateTime(row.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <span className="text-slate-500 dark:text-slate-400">Page {page + 1}</span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
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

export default Verification;
