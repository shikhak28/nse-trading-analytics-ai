import { useEffect, useMemo, useState } from "react";
import { List } from "react-window";
import { useAuth } from "../hooks/useAuth";
import { marketApi } from "../api/marketApi";
import { CompanyRow, CompanyRowHeader } from "../components/CompanyRow";
import { useLiveQuotes } from "../hooks/useLiveQuotes";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

const FILTERS = [
  { value: "all", label: "All Companies" },
  { value: "gainers", label: "Top Gainers" },
  { value: "losers", label: "Top Losers" },
  { value: "volume", label: "Top Volume" },
  { value: "top_bid", label: "Top Bid" },
  { value: "top_sell", label: "Top Sell" },
  { value: "range", label: "% Change Screen" },
];

const formatDateTime = (value) => (value ? new Date(value).toLocaleString("en-IN") : "Never");

const DashboardPage = () => {
  const { isAuthenticated } = useAuth();
  const [historySummary, setHistorySummary] = useState([]);
  const [depthSummary, setDepthSummary] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [rangeMin, setRangeMin] = useState(3);
  const [rangeMax, setRangeMax] = useState(5);
  const [companies, setCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState(null);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, stopIndex: 15 });

  // Only subscribe to live ticks for rows actually scrolled into view --
  // not all 2000+ fetched companies -- so the backend only asks Kite to
  // stream symbols someone is actually looking at.
  const visibleSymbols = useMemo(
    () => companies.slice(visibleRange.startIndex, visibleRange.stopIndex + 1).map((company) => company.symbol),
    [companies, visibleRange]
  );
  const liveQuotes = useLiveQuotes(visibleSymbols);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const [historyData, depthData] = await Promise.all([
          marketApi.fetchHistoricalSummary(),
          marketApi.fetchDepthSummary(),
        ]);
        if (historyData.success) {
          setHistorySummary(historyData.results);
        }
        if (depthData.success) {
          setDepthSummary(depthData);
        }
      } catch (err) {
        console.error("Failed to load history/depth summary", err);
      }
    };

    loadSummary();
  }, []);

  // One-off, unpaginated count for the "COMPANIES TRACKED" stat card --
  // decoupled from the paginated listing below so paging doesn't move it.
  useEffect(() => {
    const loadTotalCount = async () => {
      try {
        const data = await marketApi.getCompanies({ limit: 5000 });
        if (data.success) {
          setTotalCompanies(data.results.length);
        }
      } catch (err) {
        console.error("Failed to load company count", err);
      }
    };

    loadTotalCount();
  }, []);

  // Debounced company search -- refetches from the backend (pg_trgm-indexed)
  // instead of filtering client-side. Paginated 50-at-a-time via limit/offset
  // rather than fetching the full company list. Only runs in "all companies"
  // mode; the other tabs replace this with a ranked/screened fetch below.
  useEffect(() => {
    if (filter !== "all") return;

    const handle = setTimeout(async () => {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const data = await marketApi.getCompanies({ search, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        if (data.success) {
          setCompanies(data.results);
        } else {
          setCompaniesError(data.message || "Unable to load companies.");
        }
      } catch (err) {
        console.error("Failed to load companies", err);
        setCompaniesError(err.message || "Unable to load companies.");
      } finally {
        setCompaniesLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [search, filter, page]);

  // "Top X" filters rank by a live-quote metric (see backend/services/movers.service.js)
  // instead of the alphabetical/search listing above.
  useEffect(() => {
    if (filter === "all" || filter === "range") return;
    let ignore = false;

    const load = async () => {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const data = await marketApi.fetchMovers(filter, 50);
        if (ignore) return;
        if (data.success) {
          setCompanies(data.results);
        } else {
          setCompaniesError(data.message || "Unable to load top companies.");
        }
      } catch (err) {
        if (!ignore) setCompaniesError(err.message || "Unable to load top companies.");
      } finally {
        if (!ignore) setCompaniesLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [filter]);

  // "% Change Screen" tab -- companies whose live change_percent today falls
  // within [rangeMin, rangeMax] (see backend's /market/movers/range).
  useEffect(() => {
    if (filter !== "range") return;
    let ignore = false;

    const handle = setTimeout(async () => {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const data = await marketApi.fetchMoversRange({ min: rangeMin, max: rangeMax, limit: 50 });
        if (ignore) return;
        if (data.success) {
          setCompanies(data.results);
        } else {
          setCompaniesError(data.message || "Unable to load screened companies.");
        }
      } catch (err) {
        if (!ignore) setCompaniesError(err.message || "Unable to load screened companies.");
      } finally {
        if (!ignore) setCompaniesLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [filter, rangeMin, rangeMax]);

  const selectFilter = (value) => {
    setFilter(value);
    setSearch("");
    setPage(0);
  };

  const lastSyncedAt = useMemo(() => historySummary[0]?.last_candle, [historySummary]);

  const stats = [
    { label: "COMPANIES TRACKED", value: totalCompanies.toLocaleString("en-IN") },
    { label: "SYMBOLS WITH HISTORY", value: historySummary.length.toLocaleString("en-IN") },
    { label: "LAST SYNC", value: lastSyncedAt ? lastSyncedAt.slice(0, 10) : "Never" },
    { label: "ZERODHA STATUS", value: isAuthenticated ? "Connected" : "Disconnected" },
  ];

  return (
    <div className="p-8">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Market Overview</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-xs">Track companies, stock performance and trading activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {stats.map((item) => (
          <div key={item.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
            <p className="text-slate-500 dark:text-slate-400 text-[12px]">{item.label}</p>
            <h2 className="text-lg font-semibold mt-2 text-slate-800 dark:text-slate-100">{item.value}</h2>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Companies</h2>
            <span className="text-slate-500 dark:text-slate-400 text-[12px]">
              {companiesLoading ? "Loading..." : `${companies.length.toLocaleString("en-IN")} shown`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                onClick={() => selectFilter(item.value)}
                className={`rounded-full px-4 py-2 text-xs font-medium transition border ${
                  filter === item.value
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {filter === "all" && (
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search company..."
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl px-5 py-3 w-80 outline-none focus:border-blue-400 shadow-sm text-slate-800 dark:text-slate-100"
              />
            )}
            {filter === "range" && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span>Change %</span>
                <input
                  type="number"
                  step="0.1"
                  value={rangeMin}
                  onChange={(event) => setRangeMin(Number(event.target.value))}
                  className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 outline-none focus:border-blue-400 text-slate-800 dark:text-slate-100"
                />
                <span>to</span>
                <input
                  type="number"
                  step="0.1"
                  value={rangeMax}
                  onChange={(event) => setRangeMax(Number(event.target.value))}
                  className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 outline-none focus:border-blue-400 text-slate-800 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          <CompanyRowHeader />
          {companiesError ? (
            <div className="py-10 text-center text-red-600 dark:text-red-400 text-sm">{companiesError}</div>
          ) : companies.length === 0 && !companiesLoading ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400 text-sm">
              {filter === "all"
                ? "No companies match your search."
                : "No live data available for this filter yet (market may be closed)."}
            </div>
          ) : (
            <List
              rowComponent={CompanyRow}
              rowCount={companies.length}
              rowHeight={56}
              rowProps={{ companies, quotes: liveQuotes }}
              onRowsRendered={(visibleRows) =>
                setVisibleRange((prev) =>
                  prev.startIndex === visibleRows.startIndex && prev.stopIndex === visibleRows.stopIndex
                    ? prev
                    : visibleRows
                )
              }
              style={{ height: 480 }}
            />
          )}

          {filter === "all" && (
            <div className="flex items-center justify-between mt-3 text-xs text-slate-500 dark:text-slate-400">
              <button
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                disabled={page === 0}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 disabled:opacity-40 hover:border-blue-400"
              >
                Prev
              </button>
              <span>Page {page + 1}</span>
              <button
                onClick={() => setPage((prev) => prev + 1)}
                disabled={companies.length < PAGE_SIZE}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 disabled:opacity-40 hover:border-blue-400"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Historical Sync</h3>
               
              </div>
             
            </div>

            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-3 mb-3 text-[12px] text-slate-700 dark:text-slate-300 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Candle data synced until</span>
                <span className="font-semibold">{formatDateTime(lastSyncedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Depth data captured until</span>
                <span className="font-semibold">{formatDateTime(depthSummary?.last_snapshot)}</span>
              </div>
            </div>

            <div className="space-y-3 text-[12px] text-slate-700 dark:text-slate-300">
              {historySummary.slice(0, 3).map((item) => (
                <div key={`${item.symbol}-${item.interval}`} className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.symbol}</p>
                      <p className="text-slate-500 dark:text-slate-400">{item.count} candles stored</p>
                    </div>

                    <span className="text-slate-500 dark:text-slate-400 text-xs">{item.last_candle?.slice(0,10)}</span>
                  </div>
                </div>
              ))}
              {historySummary.length === 0 && (
                <div className="text-slate-500 dark:text-slate-400">No stored historical symbols yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
