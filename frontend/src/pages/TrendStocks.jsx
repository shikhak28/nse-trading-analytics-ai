import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { marketApi } from "../api/marketApi";
import { formatVolume } from "../utils/volume";
import { formatDay, previousTradingDay } from "../utils/tradingDays";

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

const SIGNALS = {
  positive: { label: "Positive", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  negative: { label: "Negative", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  none: { label: "No clear signal", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

// Click a column header to sort by it: first click high to low, second
// low to high. Text columns start A to Z.
const SIGNAL_RANK = { positive: 2, none: 1, negative: 0 };
const SORT_VALUE = {
  symbol: (s) => s.symbol,
  start_close: (s) => s.start_close,
  last_close: (s) => s.last_close,
  last_volume: (s) => s.last_volume,
  total_change: (s) => s.total_change,
  signal: (s) => (s.signal ? SIGNAL_RANK[s.signal] : null),
  expected_return: (s) => s.expected_return,
  actual_return: (s) => s.actual_return,
  avg_traded_value: (s) => s.avg_traded_value,
};

function pctMove(v) {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function ActualCell({ s }) {
  if (s.actual_return == null) return <span className="text-[11px] text-slate-400">{s.expected_return == null ? "—" : "Waiting"}</span>;
  const right = s.expected_return != null && Math.sign(s.actual_return) === Math.sign(s.expected_return);
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
      {s.actual_live && (
        <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="Market is open: live price, final after close">
          LIVE
        </span>
      )}
      <span className={`font-medium ${s.actual_return >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{pctMove(s.actual_return)}</span>
      {s.expected_return != null && (
        <span
          className={`rounded-full px-1.5 text-[11px] font-bold ${right ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}
        >
          {right ? "✓" : "✗"}
        </span>
      )}
    </span>
  );
}

function SortHeader({ label, sortKey, sort, onSort, align = "right", title }) {
  const active = sort.key === sortKey;
  return (
    <th className={`pb-2 pr-3 font-medium ${align === "right" ? "text-right" : ""}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-blue-600 ${active ? "text-blue-600 dark:text-blue-400" : ""}`}
      >
        {label}
        <span className="text-[10px]">{active ? (sort.dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}

function SignalBadge({ signal }) {
  if (!signal) return <span className="text-[11px] text-slate-400">—</span>;
  const s = SIGNALS[signal];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}>{s.label}</span>;
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
  // key null = default order (biggest trend first).
  const [sort, setSort] = useState({ key: null, dir: "desc" });
  const onSort = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "symbol" ? "asc" : "desc" }
    );
    setPage(0);
  };
  const [period, setPeriod] = useState("1m");
  const [signalFilter, setSignalFilter] = useState("all");
  // "" = latest. Otherwise the day being predicted, as on the other pages:
  // trends as of the previous trading day's close, and how that day went.
  const [date, setDate] = useState("");

  useEffect(() => {
    let ignore = false;
    marketApi
      .getTrends(date ? previousTradingDay(date) : undefined)
      .then((res) => {
        if (ignore) return;
        if (res.success) {
          setData({ ...res, forDate: date });
          setError(null);
        } else setError(res.message || "Unable to load trends.");
      })
      .catch((err) => !ignore && setError(err.message || "Unable to load trends."));
    return () => {
      ignore = true;
    };
  }, [date]);

  // Live actual moves while the market is open: refresh every minute.
  const hasLive = data?.forDate === date && Object.values(data?.periods ?? {}).some((l) => [...l.rising, ...l.falling].some((s) => s.actual_live));
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(() => {
      marketApi
        .getTrends(date ? previousTradingDay(date) : undefined)
        .then((res) => res.success && setData({ ...res, forDate: date }))
        .catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [hasLive, date]);

  const ready = data && data.forDate === date;
  const stocks = useMemo(() => {
    if (!data || data.forDate !== date) return [];
    const needle = search.trim().toLowerCase();
    const list = (data.periods?.[period]?.[view] ?? []).filter(
      (s) =>
        (s.avg_traded_value ?? 0) >= minValue &&
        (signalFilter === "all" || s.signal === signalFilter) &&
        (!needle || s.symbol.toLowerCase().includes(needle) || s.company_name?.toLowerCase().includes(needle))
    );
    if (!sort.key) return list;
    // Empty values always go last, whichever direction.
    const value = SORT_VALUE[sort.key];
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va == null) return vb == null ? 0 : 1;
      if (vb == null) return -1;
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
  }, [data, date, view, search, minValue, sort, signalFilter, period]);

  const totalPages = Math.max(1, Math.ceil(stocks.length / PAGE_SIZE));
  const pageStocks = stocks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const info = data?.periodInfo?.find((p) => p.key === period) ?? { label: "1 month", stepLabel: "week", steps: 4 };
  const periodButtons = data?.periodInfo ?? [
    { key: "1w", label: "1 week" },
    { key: "1m", label: "1 month" },
  ];

  const tabs = [
    { value: "rising", label: "Steady Risers", count: data?.periods?.[period]?.rising.length },
    { value: "falling", label: "Steady Fallers", count: data?.periods?.[period]?.falling.length },
  ];

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Trend Stocks</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {view === "rising"
              ? `Stocks that closed higher every ${info.stepLabel} for the last ${info.label}.`
              : `Stocks that closed lower every ${info.stepLabel} for the last ${info.label}.`}{" "}
            A week is 5 trading days. Past trend, not a forecast.
          </p>
          {date && (
            <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
              Showing trends as of {formatDay(previousTradingDay(date))} close, and how {formatDay(date)} actually went.
            </p>
          )}
          {data?.predictionDay && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Signal and expected move are the model's view for the next trading day, made on {data.predictionDay}.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Predictions for
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(0);
              }}
              className={field}
            />
          </label>
          {date && (
            <button type="button" onClick={() => setDate("")} className={field}>
              Latest
            </button>
          )}
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
          <select
            value={signalFilter}
            onChange={(e) => {
              setSignalFilter(e.target.value);
              setPage(0);
            }}
            className={field}
            aria-label="Signal"
          >
            <option value="all">All signals</option>
            <option value="positive">Positive only</option>
            <option value="negative">Negative only</option>
            <option value="none">No clear signal</option>
          </select>
          {sort.key && (
            <button type="button" onClick={() => setSort({ key: null, dir: "desc" })} className={field}>
              Reset order
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Period</span>
        {periodButtons.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setPeriod(p.key);
              setPage(0);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              period === p.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
            }`}
          >
            {p.label}
          </button>
        ))}
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
      ) : !ready ? (
        <div className={`${card} p-6`}>Scanning prices... (a new date can take up to a minute)</div>
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
                    <SortHeader label="Stock" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                    <SortHeader label={`${info.label} ago`} sortKey="start_close" sort={sort} onSort={onSort} />
                    <SortHeader label="Last close" sortKey="last_close" sort={sort} onSort={onSort} />
                    <SortHeader label="Volume" sortKey="last_volume" sort={sort} onSort={onSort} title="Shares traded in the last session" />
                    <SortHeader label="Total change" sortKey="total_change" sort={sort} onSort={onSort} />
                    <th className="pb-2 pr-3 font-medium">Each {info.stepLabel}</th>
                    <SortHeader label="Signal" sortKey="signal" sort={sort} onSort={onSort} align="left" />
                    <SortHeader label="Expected move" sortKey="expected_return" sort={sort} onSort={onSort} />
                    <SortHeader label="Actual move" sortKey="actual_return" sort={sort} onSort={onSort} title="What the predicted day actually did" />
                    <SortHeader label="Avg traded/day" sortKey="avg_traded_value" sort={sort} onSort={onSort} />
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
                      <td className="py-2 pr-3 text-right">{formatVolume(s.last_volume)}</td>
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
                      <td className="py-2 pr-3">
                        <SignalBadge signal={s.signal} />
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-medium ${
                          s.expected_return == null
                            ? "text-slate-400"
                            : s.expected_return >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {s.expected_return == null ? "—" : `${s.expected_return >= 0 ? "+" : ""}${(s.expected_return * 100).toFixed(2)}%`}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <ActualCell s={s} />
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
