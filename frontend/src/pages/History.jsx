import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marketApi } from "../api/marketApi";
import CompanyList from "../components/History/CompanyList";
import CompanyDetails from "../components/History/CompanyDetails";
import HistoryChart from "../components/History/HistoryChart";
import HistoricalTable from "../components/History/HistoricalTable";
import TimeframeSelector from "../components/History/TimeframeSelector";
import DepthPanel from "../components/History/DepthPanel";
import { timeframeToRange } from "../utils/timeframe";

const History = () => {
  const { symbol: paramSymbol } = useParams();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const [companies, setCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState(null);

  const [manualSymbol, setManualSymbol] = useState(paramSymbol ? paramSymbol.toUpperCase() : null);

  const [timeframe, setTimeframe] = useState("1Y");
  const [candles, setCandles] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [depthSnapshot, setDepthSnapshot] = useState(null);
  const [depthLoading, setDepthLoading] = useState(false);
  const [depthError, setDepthError] = useState(null);

  const range = useMemo(() => timeframeToRange(timeframe), [timeframe]);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load the company list, refetching whenever the debounced search changes.
  // Only runs in "all companies" mode -- a "top X" filter uses the ranked
  // /market/movers fetch below instead.
  useEffect(() => {
    if (filter !== "all") return;
    let ignore = false;

    const load = async () => {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const result = await marketApi.getCompanies({ search: debouncedSearch || undefined, limit: 200 });
        if (ignore) return;
        if (result.success) {
          setCompanies(result.results || []);
        } else {
          setCompaniesError(result.message || "Unable to load companies.");
        }
      } catch (err) {
        if (!ignore) setCompaniesError(err.message || "Unable to load companies.");
      } finally {
        if (!ignore) setCompaniesLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [debouncedSearch, filter]);

  // "Top X" filters rank companies by a live-quote metric (gainers, losers,
  // volume, top_bid, top_sell) rather than the alphabetical search listing.
  useEffect(() => {
    if (filter === "all") return;
    let ignore = false;

    const load = async () => {
      setCompaniesLoading(true);
      setCompaniesError(null);
      try {
        const result = await marketApi.fetchMovers(filter, 50);
        if (ignore) return;
        if (result.success) {
          setCompanies(result.results || []);
        } else {
          setCompaniesError(result.message || "Unable to load top companies.");
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

  // Derive the active selection at render time instead of syncing it via an
  // effect: falls back to the URL's symbol, then the first loaded company,
  // until the user clicks a row (manualSymbol).
  const selectedSymbol = manualSymbol || companies[0]?.symbol || null;
  const selectedCompany = companies.find((c) => c.symbol === selectedSymbol) || (selectedSymbol ? { symbol: selectedSymbol } : null);

  // Fetch candle data whenever the selected company or timeframe changes.
  useEffect(() => {
    if (!selectedSymbol) return;
    let ignore = false;

    const load = async () => {
      setChartLoading(true);
      setChartError(null);
      try {
        const result = await marketApi.fetchStoredHistorical(selectedSymbol, "day", range.from, range.to);
        if (ignore) return;
        if (result.success && Array.isArray(result.results) && result.results.length > 0) {
          setCandles(result.results);
        } else {
          setCandles([]);
          setChartError("No historical data exists for this company in the selected timeframe.");
        }
      } catch (err) {
        if (!ignore) {
          setCandles([]);
          setChartError(err.message || "Unable to load historical data.");
        }
      } finally {
        if (!ignore) setChartLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [selectedSymbol, range.from, range.to]);

  // Fetch the latest depth snapshot for the selected company -- depth is
  // captured minute-by-minute (see backend/jobs/depthSnapshot.job.js) and is
  // independent of whatever's stored in historical_prices, so this loads
  // separately from the candle fetch above.
  useEffect(() => {
    if (!selectedSymbol) return;
    let ignore = false;

    const load = async () => {
      setDepthLoading(true);
      setDepthError(null);
      try {
        const result = await marketApi.fetchStoredDepth(selectedSymbol, selectedCompany?.exchange || "NSE", undefined, undefined, 1);
        if (ignore) return;
        if (result.success && Array.isArray(result.results) && result.results.length > 0) {
          setDepthSnapshot(result.results[0]);
        } else {
          setDepthSnapshot(null);
          setDepthError("No depth snapshots captured yet for this company.");
        }
      } catch (err) {
        if (!ignore) {
          setDepthSnapshot(null);
          setDepthError(err.message || "Unable to load depth data.");
        }
      } finally {
        if (!ignore) setDepthLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [selectedSymbol, selectedCompany?.exchange]);

  const periodStats = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    const sorted = [...candles].sort((a, b) => new Date(a.date) - new Date(b.date));
    return {
      open: Number(sorted[0].open),
      close: Number(sorted[sorted.length - 1].close),
      high: Math.max(...sorted.map((c) => Number(c.high))),
      low: Math.min(...sorted.map((c) => Number(c.low))),
      volume: sorted.reduce((sum, c) => sum + Number(c.volume), 0),
      lastUpdated: sorted[sorted.length - 1].date,
    };
  }, [candles]);

  const handleSelect = (symbol) => {
    setManualSymbol(symbol);
    navigate(`/history/${symbol}`, { replace: true });
  };

  const handleSync = async () => {
    if (!selectedSymbol) return;
    setSyncing(true);
    try {
      await marketApi.syncHistorical(selectedSymbol, "day");
      setChartError("Sync started — this can take up to a minute. Change the timeframe or come back shortly to refresh.");
    } catch (err) {
      setChartError(err.message || "Unable to queue sync.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-6 p-8 text-slate-900 dark:text-slate-100 lg:grid-cols-[320px_1fr]">
      <div className="lg:h-[calc(100vh-4rem)]">
        <CompanyList
          companies={companies}
          selectedSymbol={selectedSymbol}
          onSelect={handleSelect}
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={(value) => {
            setFilter(value);
            setSearch("");
          }}
          loading={companiesLoading}
          error={companiesError}
        />
      </div>

      <div className="min-w-0 space-y-6">
        {!selectedSymbol ? (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-sm text-slate-500 dark:text-slate-400 shadow-sm">
            Select a company from the list to view its historical data.
          </div>
        ) : (
          <>
            <CompanyDetails company={selectedCompany} periodStats={periodStats} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <TimeframeSelector value={timeframe} onChange={setTimeframe} />
              {chartError && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-60"
                >
                  {syncing ? "Queuing sync..." : "Sync 3 years of data"}
                </button>
              )}
            </div>

            {chartLoading ? (
              <div className="flex h-80 items-center justify-center rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-500 dark:text-slate-400 shadow-sm">
                <div className="mr-3 h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                Loading historical data...
              </div>
            ) : chartError ? (
              <div className="rounded-3xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-8 text-sm text-amber-800 dark:text-amber-300 shadow-sm">
                {chartError}
              </div>
            ) : (
              <>
                <HistoryChart candles={candles} />
                <HistoricalTable candles={candles} />
              </>
            )}

            <DepthPanel snapshot={depthSnapshot} loading={depthLoading} error={depthError} />
          </>
        )}
      </div>
    </div>
  );
};

export default History;
