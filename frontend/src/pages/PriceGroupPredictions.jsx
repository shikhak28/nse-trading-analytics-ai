import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";
import { PRICE_BANDS, matchesBand } from "../utils/priceBands";
import { formatVolume } from "../utils/volume";
import { formatDay, previousTradingDay, todayIso } from "../utils/tradingDays";

const PAGE_SIZE = 20;

const card = "rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm";
const field = "rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100";

function formatMove(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatChance(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const SIGNALS = {
  positive: { label: "Positive", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  negative: { label: "Negative", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  none: { label: "No clear signal", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

function SignalBadge({ stock }) {
  const signal = SIGNALS[stock.signal] || SIGNALS.none;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${signal.className}`}>{signal.label}</span>;
}

function formatPrice(value) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Right = the stock actually moved the way it was predicted.
function isRight(stock) {
  return Math.sign(stock.actual_return) === Math.sign(stock.expected_return) && stock.actual_return !== 0;
}

function ActualCell({ stock }) {
  if (stock.actual_return == null) {
    return <span className="text-[11px] text-slate-400">Waiting</span>;
  }
  const right = isRight(stock);
  return (
    <div className="flex items-center justify-end gap-1.5">
{stock.actual_live && <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="Market is open: live price, final after close">LIVE</span>}
      <span className={`font-semibold ${stock.actual_return >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
        {formatMove(stock.actual_return)}
      </span>
      <span
        className={`rounded-full px-1.5 text-[11px] font-bold ${right ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}
        title={right ? "Moved the predicted way" : "Moved the other way"}
      >
        {right ? "✓" : "✗"}
      </span>
    </div>
  );
}

function scoreOf(stocks) {
  const done = stocks.filter((s) => s.actual_return != null);
  const right = done.filter(isRight).length;
  const avg = done.length ? done.reduce((sum, s) => sum + s.actual_return, 0) / done.length : null;
  return { total: done.length, right, avg };
}

function ScoreBox({ label, score }) {
  const pct = score.total ? Math.round((score.right / score.total) * 100) : null;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      {score.total === 0 ? (
        <div className="mt-1 text-sm text-slate-400">No results</div>
      ) : (
        <>
          <div className="mt-1 text-2xl font-semibold">
            {score.right} <span className="text-base font-normal text-slate-500">of {score.total} right</span>
          </div>
          <div className="mt-1 text-xs">
            <span className={pct >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{pct}% right</span>
            <span className="text-slate-500 dark:text-slate-400"> · avg actual move </span>
            <span className={score.avg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{formatMove(score.avg)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ResultSummary({ date, rising, falling }) {
  const all = [...rising, ...falling];
  const done = all.filter((s) => s.actual_return != null).length;
  if (all.length === 0) return null;
  if (done === 0) {
    return (
      <div className={`${card} mb-6 p-5 text-sm text-slate-500 dark:text-slate-400`}>
        Result for {formatDay(date)}: not ready yet. It shows here after that day's market close (prices sync at ~4:30 PM).
      </div>
    );
  }
  const positive = all.filter((s) => s.signal === "positive");
  const negative = all.filter((s) => s.signal === "negative");
  return (
    <div className={`${card} mb-6 p-5`}>
      <h2 className="mb-3 text-sm font-medium">
        Result for {formatDay(date)}{" "}
        {all.some((s) => s.actual_live) && (
          <span className="rounded bg-blue-100 px-1.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">LIVE, so far today</span>
        )}{" "}
        <span className="font-normal text-slate-500 dark:text-slate-400">(stocks shown with current filters)</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreBox label="Expected to Rise" score={scoreOf(rising)} />
        <ScoreBox label="Expected to Fall" score={scoreOf(falling)} />
        <ScoreBox label="Positive signal" score={scoreOf(positive)} />
        <ScoreBox label="Negative signal" score={scoreOf(negative)} />
      </div>
    </div>
  );
}

function MoveTable({ title, stocks, moveClass, madeOn }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(stocks.length / PAGE_SIZE));
  const pageStocks = stocks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className={`${card} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{stocks.length} stocks</span>
      </div>

      {stocks.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No stocks here.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 dark:text-slate-400">
                <th className="pb-2 pr-3 font-medium">Stock</th>
                <th className="pb-2 pr-3 font-medium">Signal</th>
                <th className="pb-2 pr-3 text-right font-medium">Last close</th>
                <th className="pb-2 pr-3 text-right font-medium" title="Shares traded in the last session">Volume</th>
                <th className="pb-2 pr-3 text-right font-medium">Expected move</th>
                <th className="pb-2 pr-3 text-right font-medium">Actual move</th>
                <th className="pb-2 pr-3 text-right font-medium">Chance of +2%</th>
                <th className="pb-2 text-right font-medium">Chance of −2%</th>
              </tr>
            </thead>
            <tbody>
              {pageStocks.map((stock) => (
                <tr key={`${stock.exchange}-${stock.symbol}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{stock.symbol}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{stock.exchange}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <SignalBadge stock={stock} />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div>{formatPrice(stock.last_close)}</div>
                    {stock.last_close_day && stock.last_close_day !== madeOn && (
                      <div
                        className="text-[10px] text-amber-600 dark:text-amber-400"
                        title="No candle for the prediction day was synced in time, so this is an older close."
                      >
                        as of {formatDay(stock.last_close_day)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatVolume(stock.last_volume)}</td>
                  <td className={`py-2 pr-3 text-right text-sm font-semibold ${moveClass}`}>{formatMove(stock.expected_return)}</td>
                  <td className="py-2 pr-3 text-right">
                    <ActualCell stock={stock} />
                  </td>
                  <td className="py-2 pr-3 text-right">{formatChance(stock.chance_up)}</td>
                  <td className="py-2 text-right">{formatChance(stock.chance_down)}</td>
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
  );
}

function PriceGroupPredictions() {
  const [date, setDate] = useState(todayIso());
  const [bandValue, setBandValue] = useState("high_risk");
  const [search, setSearch] = useState("");
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [signalFilter, setSignalFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const madeOn = previousTradingDay(date);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getPriceGroupStocks(madeOn);
        if (ignore) return;
        if (data.success) {
          setRows(data.results);
          setError(null);
        } else {
          setError(data.message || "Unable to load predictions.");
        }
      } catch (err) {
        if (!ignore) setError(err.message || "Unable to load predictions.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [madeOn]);

  // Live actual moves during market hours: refresh every minute, silently.
  const hasLive = rows.some((row) => row.actual_live);
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(async () => {
      try {
        const data = await predictionsApi.getPriceGroupStocks(madeOn);
        if (data.success) setRows(data.results);
      } catch {
        // keep the last numbers; the next tick retries
      }
    }, 60000);
    return () => clearInterval(id);
  }, [hasLive, madeOn]);

  // A search always shows its matches, even thin stocks -- otherwise
  // looking up a specific small stock would come back empty.
  const searching = search.trim() !== "";
  const stocks = useMemo(() => (liquidOnly && !searching ? rows.filter((s) => s.liquid) : rows), [rows, liquidOnly, searching]);
  const band = bandValue === "all" ? null : PRICE_BANDS.find((item) => item.value === bandValue);

  const { rising, falling } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const inGroup = stocks.filter(
      (stock) =>
        (!band || matchesBand(stock, band)) &&
        (signalFilter === "all" || stock.signal === signalFilter) &&
        (!needle || stock.symbol.toLowerCase().includes(needle) || stock.company_name?.toLowerCase().includes(needle))
    );
    return {
      rising: inGroup.filter((s) => s.expected_return > 0).sort((a, b) => b.expected_return - a.expected_return),
      falling: inGroup.filter((s) => s.expected_return < 0).sort((a, b) => a.expected_return - b.expected_return),
    };
  }, [stocks, band, search, signalFilter]);

  const counts = useMemo(
    () => ({
      all: stocks.length,
      ...Object.fromEntries(PRICE_BANDS.map((item) => [item.value, stocks.filter((s) => matchesBand(s, item)).length])),
    }),
    [stocks]
  );
  const bandButtons = [{ value: "all", label: "All prices", range: "" }, ...PRICE_BANDS];

  const tableKey = `${bandValue}-${madeOn}-${search}-${liquidOnly}-${signalFilter}`;

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Price Group Predictions</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            How much the model expects each stock to move on{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">{formatDay(date)}</span>, close to close
            (predicted after market close on {formatDay(madeOn)}). These are model estimates, not guarantees.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">Positive</span> /{" "}
            <span className="font-medium text-red-600 dark:text-red-400">Negative</span>: the chance of one direction is at
            least 15 points higher than the other, and the expected move beats the ~0.3% trading cost. Otherwise{" "}
            <span className="font-medium">No clear signal</span>. Research only, not investment advice.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or company..."
            className={`${field} w-56`}
          />
          <label className={`${field} flex cursor-pointer items-center gap-2`} title="Hides stocks trading under ₹20 crore a day, and trade-to-trade (-BE) / SME (-SM, -ST) stocks">
            <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} />
            Only liquid stocks
          </label>
          <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)} className={field} aria-label="Signal">
            <option value="all">All signals</option>
            <option value="positive">Positive only</option>
            <option value="negative">Negative only</option>
            <option value="none">No clear signal</option>
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Predictions for"
            className={field}
          />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {bandButtons.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setBandValue(item.value)}
            className={`rounded-full border px-4 py-2 text-sm ${
              bandValue === item.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
            }`}
          >
            <span className="font-medium">{item.label}</span>
            {item.range && <span className="ml-1.5 opacity-75">{item.range}</span>}
            <span className="ml-1.5 opacity-75">({counts[item.value]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={`${card} p-6`}>Loading predictions...</div>
      ) : error ? (
        <div className={`${card} p-6 text-red-600 dark:text-red-400`}>{error}</div>
      ) : (
        <>
        <ResultSummary date={date} rising={rising} falling={falling} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <MoveTable key={`up-${tableKey}`} title="Expected to Rise" stocks={rising} madeOn={madeOn} moveClass="text-emerald-600 dark:text-emerald-400" />
          <MoveTable key={`down-${tableKey}`} title="Expected to Fall" stocks={falling} madeOn={madeOn} moveClass="text-red-600 dark:text-red-400" />
        </div>
        </>
      )}
    </div>
  );
}

export default PriceGroupPredictions;
