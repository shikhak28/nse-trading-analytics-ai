import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { marketApi } from "../api/marketApi";

const PAGE_SIZE = 25;

const card = "rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm";
const field = "rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100";

// Minimum average daily traded value (₹) over the last 20 days.
const LIQUIDITY_OPTIONS = [
  { value: 0, label: "All stocks" },
  { value: 2e7, label: "₹2 cr+/day" },
  { value: 2e8, label: "₹20 cr+/day" },
];

function pct(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function price(value) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function crore(value) {
  if (value == null) return "—";
  return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 })} cr`;
}

// One small bar per month, oldest on the left, height scaled to the move.
function MonthBars({ monthly }) {
  const max = Math.max(...monthly.map((m) => Math.abs(m)), 0.0001);
  return (
    <div className="flex h-6 items-end gap-0.5" title={monthly.map(pct).join("  →  ")}>
      {monthly.map((m, i) => (
        <div
          key={i}
          className={`w-2 rounded-sm ${m >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ height: `${Math.max(15, (Math.abs(m) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function TrendStocks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("rising");
  const [search, setSearch] = useState("");
  const [minValue, setMinValue] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    marketApi
      .getTrends()
      .then((res) => (res.success ? setData(res) : setError(res.message || "Unable to load trends.")))
      .catch((err) => setError(err.message || "Unable to load trends."));
  }, []);

  const stocks = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data[view].filter(
      (s) =>
        (s.avg_traded_value ?? 0) >= minValue &&
        (!needle || s.symbol.toLowerCase().includes(needle) || s.company_name?.toLowerCase().includes(needle))
    );
  }, [data, view, search, minValue]);

  const totalPages = Math.max(1, Math.ceil(stocks.length / PAGE_SIZE));
  const pageStocks = stocks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const months = data ? (view === "rising" ? data.risingMonths : data.fallingMonths) : view === "rising" ? 3 : 6;

  const tabs = [
    { value: "rising", label: `Steady Risers · ${data?.risingMonths ?? 3} months`, count: data?.rising.length },
    { value: "falling", label: `Steady Fallers · ${data?.fallingMonths ?? 6} months`, count: data?.falling.length },
  ];

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Trend Stocks</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {view === "rising"
              ? `Stocks that closed higher every month for the last ${months} months.`
              : `Stocks that closed lower every month for the last ${months} months.`}{" "}
            A month is 21 trading days. Past trend, not a forecast.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search symbol or company..."
            className={`${field} w-56`}
          />
          <select value={minValue} onChange={(e) => {
              setMinValue(Number(e.target.value));
              setPage(0);
            }} className={field} aria-label="Minimum daily traded value">
            {LIQUIDITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setView(t.value);
              setPage(0);
            }}
            className={`rounded-full border px-4 py-2 text-sm ${
              view === t.value
                ? t.value === "rising"
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-red-600 bg-red-600 text-white"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
            }`}
          >
            <span className="font-medium">{t.label}</span>
            {t.count != null && <span className="ml-1.5 opacity-75">({t.count})</span>}
          </button>
        ))}
      </div>

      {error ? (
        <div className={`${card} p-6 text-red-600 dark:text-red-400`}>{error}</div>
      ) : !data ? (
        <div className={`${card} p-6`}>Scanning 7 months of prices... (first load can take a little while)</div>
      ) : (
        <div className={`${card} p-5`}>
          <div className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">{stocks.length} stocks</div>
          {stocks.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No stocks match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="pb-2 pr-3 font-medium">Stock</th>
                    <th className="pb-2 pr-3 text-right font-medium">{months} months ago</th>
                    <th className="pb-2 pr-3 text-right font-medium">Last close</th>
                    <th className="pb-2 pr-3 text-right font-medium">Total change</th>
                    <th className="pb-2 pr-3 font-medium">Each month</th>
                    <th className="pb-2 text-right font-medium">Avg traded/day</th>
                  </tr>
                </thead>
                <tbody>
                  {pageStocks.map((s) => (
                    <tr key={`${s.exchange}-${s.symbol}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">
                        <Link to={`/history/${s.symbol}`} className="font-medium hover:text-blue-600">
                          {s.symbol}
                        </Link>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{s.company_name}</div>
                      </td>
                      <td className="py-2 pr-3 text-right">{price(s.start_close)}</td>
                      <td className="py-2 pr-3 text-right">{price(s.last_close)}</td>
                      <td
                        className={`py-2 pr-3 text-right text-sm font-semibold ${
                          s.total_change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {pct(s.total_change)}
                      </td>
                      <td className="py-2 pr-3">
                        <MonthBars monthly={s.monthly} />
                      </td>
                      <td className="py-2 text-right text-slate-500 dark:text-slate-400">{crore(s.avg_traded_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setPage((p) => p - 1)}
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
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1}
                    className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TrendStocks;
