import { useEffect, useMemo, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";
import { PRICE_BANDS, matchesBand } from "../utils/priceBands";
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

function formatPrice(value) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
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
                <th className="pb-2 pr-3 text-right font-medium">Last close</th>
                <th className="pb-2 pr-3 text-right font-medium">Expected move</th>
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
                  <td className={`py-2 pr-3 text-right text-sm font-semibold ${moveClass}`}>{formatMove(stock.expected_return)}</td>
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

  const stocks = rows;
  const band = PRICE_BANDS.find((item) => item.value === bandValue);

  const { rising, falling } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const inGroup = stocks.filter(
      (stock) =>
        matchesBand(stock, band) &&
        (!needle || stock.symbol.toLowerCase().includes(needle) || stock.company_name?.toLowerCase().includes(needle))
    );
    return {
      rising: inGroup.filter((s) => s.expected_return > 0).sort((a, b) => b.expected_return - a.expected_return),
      falling: inGroup.filter((s) => s.expected_return < 0).sort((a, b) => a.expected_return - b.expected_return),
    };
  }, [stocks, band, search]);

  const counts = useMemo(
    () => Object.fromEntries(PRICE_BANDS.map((item) => [item.value, stocks.filter((s) => matchesBand(s, item)).length])),
    [stocks]
  );

  const tableKey = `${bandValue}-${madeOn}-${search}`;

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
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or company..."
            className={`${field} w-56`}
          />
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
        {PRICE_BANDS.map((item) => (
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
            <span className="ml-1.5 opacity-75">{item.range}</span>
            <span className="ml-1.5 opacity-75">({counts[item.value]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={`${card} p-6`}>Loading predictions...</div>
      ) : error ? (
        <div className={`${card} p-6 text-red-600 dark:text-red-400`}>{error}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <MoveTable key={`up-${tableKey}`} title="Expected to Rise" stocks={rising} madeOn={madeOn} moveClass="text-emerald-600 dark:text-emerald-400" />
          <MoveTable key={`down-${tableKey}`} title="Expected to Fall" stocks={falling} madeOn={madeOn} moveClass="text-red-600 dark:text-red-400" />
        </div>
      )}
    </div>
  );
}

export default PriceGroupPredictions;
