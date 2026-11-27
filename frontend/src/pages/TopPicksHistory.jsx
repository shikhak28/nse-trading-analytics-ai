import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDay } from "../utils/tradingDays";

// Top 5 picks of each Predictions list over the last 10 trading days, and
// what they actually did. Also served at /share/top-picks?k=... for people
// without a login (see backend/routes/share.routes.js).

const LISTS = [
  { key: "up4", label: "Rise 4%+", value: "chanceUp4", valueLabel: "Confidence", threshold: 4, hitLabel: "Rose 4%+?" },
  { key: "up2", label: "Rise 2%+", value: "chanceUp2", valueLabel: "Confidence", threshold: 2, hitLabel: "Rose 2%+?" },
  { key: "exp", label: "Expected move", value: "expected", valueLabel: "Expected move", threshold: null, hitLabel: "Went up?" },
];
const UNIVERSES = [
  { key: "liquid", label: "Liquid only" },
  { key: "all", label: "All stocks" },
];
const CIRCUIT_GAP = 4.5;

const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

function Toggle({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-16 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {options.map((o) => (
        <button
          key={o.key}
          id={`toggle-${label}-${o.key}`}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            value === o.key
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TopPicksHistory({ shareKey }) {
  const [days, setDays] = useState(null);
  const [error, setError] = useState(null);
  const [list, setList] = useState("up4");
  const [universe, setUniverse] = useState("liquid");

  useEffect(() => {
    let ignore = false;
    axios
      .get("/api/share/top-picks", { params: shareKey ? { k: shareKey } : {}, withCredentials: true })
      .then(({ data }) => {
        if (ignore) return;
        if (data.success) setDays(data.results);
        else setError(data.message || "Could not load the report.");
      })
      .catch((err) => !ignore && setError(err.response?.data?.message || "Could not load the report."));
    return () => {
      ignore = true;
    };
  }, [shareKey]);

  const spec = LISTS.find((l) => l.key === list);

  const summary = useMemo(() => {
    if (!days) return null;
    const picks = days.flatMap((d) => d.lists[list][universe]).filter((p) => p.actual != null);
    if (!picks.length) return null;
    const hits = picks.filter((p) => (spec.threshold ? p.actual >= spec.threshold : p.actual > 0)).length;
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      hits,
      total: picks.length,
      avgValue: avg(picks.map((p) => p[spec.value]).filter((v) => v != null)),
      avgActual: avg(picks.map((p) => p.actual)),
    };
  }, [days, list, universe, spec]);

  return (
    <div className="mx-auto max-w-5xl p-4 text-slate-900 sm:p-8 dark:text-slate-100">
      <h1 className="text-3xl font-semibold">Top 5 Picks History</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        For each of the model's lists, the top 5 stocks on each of the last 10 trading days, and how they actually moved the next
        trading day.
      </p>

      <div className="mt-6 grid gap-3">
        <Toggle label="List" options={LISTS} value={list} onChange={setList} />
        <Toggle label="Stocks" options={UNIVERSES} value={universe} onChange={setUniverse} />
      </div>

      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {!days && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {days && (
        <>
          {summary && (
            <p className="mt-6 text-base">
              <b className="font-mono">
                {summary.hits} of {summary.total}
              </b>{" "}
              {spec.threshold ? `picks rose ${spec.threshold}% or more` : "picks went up"} ({Math.round((100 * summary.hits) / summary.total)}%).{" "}
              {spec.threshold ? (
                <>
                  Average confidence was <b className="font-mono">{Math.round(summary.avgValue)}%</b>.
                </>
              ) : (
                <>
                  Average expected move <b className="font-mono">{signed(summary.avgValue)}</b>, average actual move{" "}
                  <b className="font-mono">{signed(summary.avgActual)}</b>.
                </>
              )}
            </p>
          )}

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-3 py-2 font-medium">Prediction made</th>
                  <th className="px-3 py-2 font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">{spec.valueLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Actual move</th>
                  <th className="px-3 py-2 font-medium">{spec.hitLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">Opened at</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const picks = d.lists[list][universe].filter((p) => p.actual != null);
                  if (!picks.length) {
                    return (
                      <tr key={d.day} className="border-t border-slate-200 dark:border-slate-800">
                        <td className="px-3 py-2 align-top">{formatDay(d.day)}</td>
                        <td colSpan={5} className="px-3 py-2 italic text-slate-500">
                          {list === "up4" && !d.hasUp4Model ? "The 4% model was not live yet." : "No stock passed."}
                        </td>
                      </tr>
                    );
                  }
                  return picks.map((p, i) => {
                    const hit = spec.threshold ? p.actual >= spec.threshold : p.actual > 0;
                    const value = p[spec.value];
                    return (
                      <tr key={`${d.day}-${p.symbol}`} className={i === 0 ? "border-t border-slate-200 dark:border-slate-800" : ""}>
                        {i === 0 && (
                          <td rowSpan={picks.length} className="px-3 py-2 align-top">
                            {formatDay(d.day)}
                            {d.resultDay && <span className="block text-xs text-slate-500">result {formatDay(d.resultDay)}</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 font-semibold">{p.symbol}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {value == null ? "—" : spec.threshold ? `${value.toFixed(1)}%` : signed(value)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${p.actual > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {signed(p.actual)}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${hit ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>{hit ? "Yes" : "No"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                          {p.openedAt == null ? "—" : signed(p.openedAt)}
                          {p.openedAt >= CIRCUIT_GAP && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                              opened near +5% limit
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default TopPicksHistory;
