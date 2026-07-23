import { useState } from "react";
import { marketApi } from "../api/marketApi";

const inputCls =
  "w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 outline-none focus:border-blue-400 text-[11px] disabled:opacity-50";

/**
 * Manual backfill trigger for a symbol missing from `companies` (e.g. newly
 * listed, or one the instrument-master-refresh hasn't picked up yet --
 * MTARTECH was one such gap). Just a thin UI over the existing
 * POST /market/historical/sync route -- that route already auto-upserts the
 * company via Kite's instrument list if it's not tracked yet, and
 * historicalSync.job.js already does the full 3-year lookback for any
 * symbol with no stored candles. Depth (order book) has no historical API on
 * Kite -- it's live-only -- so a newly synced symbol only starts getting
 * depth captured once depthWorker.js is (re)started and calls
 * subscribeAllTracked() again, not immediately.
 */
export function SyncSymbolPanel() {
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) return;

    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const [dayResult, minuteResult] = await Promise.all([
        marketApi.syncHistorical(trimmed, "day", exchange),
        marketApi.syncHistorical(trimmed, "minute", exchange),
      ]);
      if (dayResult.success && minuteResult.success) {
        setResult(`Queued ${trimmed} (${exchange}) -- day + minute candles syncing in the background.`);
      } else {
        setError(dayResult.message || minuteResult.message || "Unable to queue sync.");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to queue sync.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-2">
        Sync a symbol (3yr backfill)
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
        For symbols missing from the dashboard (e.g. newly listed). Queues a full 3-year day + minute candle backfill.
        Depth/order-book has no historical API -- a synced symbol only starts capturing depth after depthWorker.js is next restarted.
      </p>
      <div className="flex gap-2 mb-2">
        <input
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && handleSync()}
          placeholder="Symbol e.g. MTARTECH"
          className={`${inputCls} flex-1`}
        />
        <select value={exchange} onChange={(event) => setExchange(event.target.value)} className={`${inputCls} w-20`}>
          <option value="NSE">NSE</option>
          <option value="BSE">BSE</option>
        </select>
      </div>
      <button
        onClick={handleSync}
        disabled={syncing || !symbol.trim()}
        className="w-full rounded-md bg-blue-600 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
      >
        {syncing ? "Queuing..." : "Sync 3yr history"}
      </button>
      {result && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">{result}</p>}
      {error && <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">{error}</p>}
    </div>
  );
}
