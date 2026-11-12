import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eventsApi } from "../api/eventsApi";
import { formatDay } from "../utils/tradingDays";
import { formatRange, formatVolume } from "../utils/volume";

const card = "rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm";
const field = "rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100";
const NSE_CALENDAR_URL = "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar";
const STALE_DAYS = 7;

const SIGNALS = {
  positive: { label: "Positive", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  negative: { label: "Negative", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  none: { label: "No clear signal", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};
const SIGNAL_RANK = { positive: 2, none: 1, negative: 0 };

const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const chance = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const price = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const crore = (v) => (v == null ? "—" : `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`);

// Sortable columns: key -> value getter. null values always sort last.
const COLUMNS = [
  { key: "event_date", label: "Date", get: (e) => e.event_date, align: "left" },
  { key: "symbol", label: "Stock", get: (e) => e.symbol, align: "left" },
  { key: "purpose", label: "Event", get: (e) => e.purpose, align: "left" },
  { key: "last_close", label: "Last close", get: (e) => e.last_close },
  { key: "last_volume", label: "Volume", get: (e) => e.last_volume },
  { key: "avg_traded_value", label: "Avg traded/day", get: (e) => e.avg_traded_value },
  { key: "signal", label: "Signal", get: (e) => (e.signal ? SIGNAL_RANK[e.signal] : null), align: "left" },
  { key: "expected_return", label: "Expected move", get: (e) => e.expected_return },
  { key: "likely", label: "Likely range", get: (e) => e.likely_high },
  { key: "chance_up", label: "Chance +2%", get: (e) => e.chance_up },
  { key: "chance_down", label: "Chance −2%", get: (e) => e.chance_down },
];

function UploadCard({ status, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const lastUpload = status?.last_upload ? new Date(status.last_upload) : null;
  const ageDays = status?.age_days ?? null;
  const stale = ageDays == null || ageDays > STALE_DAYS;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await eventsApi.uploadCsv(await file.text());
      if (res.success) {
        setMessage({
          ok: true,
          text: `Saved ${res.stored} events (${res.results} results).${res.unmatchedCount ? ` ${res.unmatchedCount} symbols not tracked here, skipped.` : ""}${res.badDates ? ` ${res.badDates} rows had no readable date.` : ""}`,
        });
        onUploaded();
      } else setMessage({ ok: false, text: res.message });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} mb-6 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm">
          <div className="font-medium">Update the calendar (once a week)</div>
          <ol className="mt-1 list-decimal pl-5 text-xs text-slate-500 dark:text-slate-400">
            <li>
              Open{" "}
              <a href={NSE_CALENDAR_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                NSE Event Calendar
              </a>{" "}
              and pick the next 2–4 weeks.
            </li>
            <li>Click "Download (.csv)".</li>
            <li>Upload that file here.</li>
          </ol>
        </div>
        <div className="text-right">
          <label className={`${field} inline-block cursor-pointer bg-blue-600 text-white border-blue-600 ${busy ? "opacity-60" : ""}`}>
            {busy ? "Uploading..." : "Upload CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} disabled={busy} />
          </label>
          <div className={`mt-2 text-xs ${stale ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>
            {lastUpload
              ? `Last upload: ${lastUpload.toLocaleString("en-IN")}${stale ? " — out of date, upload a new file" : ""}`
              : "No calendar uploaded yet."}
          </div>
        </div>
      </div>
      {message && <div className={`mt-3 text-xs ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</div>}
    </div>
  );
}

function UpcomingResults() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [allEvents, setAllEvents] = useState(false);
  const [search, setSearch] = useState("");
  const [liquidOnly, setLiquidOnly] = useState(false);
  const [sort, setSort] = useState({ key: "event_date", dir: "asc" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let ignore = false;
    eventsApi
      .getUpcoming({ days, all: allEvents })
      .then((res) => {
        if (ignore) return;
        if (res.success) {
          setData(res);
          setError(null);
        } else setError(res.message);
      })
      .catch((err) => !ignore && setError(err.message));
    return () => {
      ignore = true;
    };
  }, [days, allEvents, reload]);

  const onSort = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: ["event_date", "symbol", "purpose"].includes(key) ? "asc" : "desc" }));

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (data?.results ?? []).filter(
      (e) =>
        (!liquidOnly || e.liquid) &&
        (!needle || e.symbol.toLowerCase().includes(needle) || e.company_name?.toLowerCase().includes(needle))
    );
    const col = COLUMNS.find((c) => c.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null) return vb == null ? 0 : 1;
      if (vb == null) return -1;
      return typeof va === "string" ? dir * va.localeCompare(vb) : dir * (va - vb);
    });
  }, [data, search, liquidOnly, sort]);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Upcoming Results</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Companies whose board meets soon to announce quarterly results, with the model's latest view of each stock. Prices
          often move a lot on result day, in either direction, and the model doesn't know the numbers in advance.
        </p>
      </div>

      <UploadCard status={data?.status} onUploaded={() => setReload((n) => n + 1)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or company..." className={`${field} w-56`} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={field} aria-label="Days ahead">
          <option value={7}>Next 7 days</option>
          <option value={14}>Next 14 days</option>
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
        </select>
        <select value={allEvents ? "all" : "results"} onChange={(e) => setAllEvents(e.target.value === "all")} className={field} aria-label="Event type">
          <option value="results">Results only</option>
          <option value="all">All events (dividend, bonus, ...)</option>
        </select>
        <label className={`${field} flex cursor-pointer items-center gap-2`}>
          <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} />
          Only liquid stocks
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} companies</span>
      </div>

      {error ? (
        <div className={`${card} p-6 text-red-600 dark:text-red-400`}>{error}</div>
      ) : !data ? (
        <div className={`${card} p-6`}>Loading...</div>
      ) : rows.length === 0 ? (
        <div className={`${card} p-6 text-sm text-slate-500 dark:text-slate-400`}>
          {data.status?.upcoming ? "No companies match these filters." : "No upcoming events yet. Upload the NSE Event Calendar CSV above."}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto p-5`}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-[11px] text-slate-500 dark:text-slate-400">
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`pb-2 pr-3 font-medium ${c.align === "left" ? "text-left" : "text-right"}`}>
                    <button type="button" onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 hover:text-blue-600 ${sort.key === c.key ? "text-blue-600 dark:text-blue-400" : ""}`}>
                      {c.label}
                      <span className="text-[10px]">{sort.key === c.key ? (sort.dir === "desc" ? "▼" : "▲") : "↕"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const signal = e.signal ? SIGNALS[e.signal] : null;
                return (
                  <tr key={`${e.symbol}-${e.event_date}-${e.purpose}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <div className="font-medium">{formatDay(e.event_date)}</div>
                      <div className={`text-[11px] ${e.days_left <= 3 ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>
                        {e.days_left === 0 ? "today" : e.days_left === 1 ? "tomorrow" : `in ${e.days_left} days`}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <Link to={`/history/${e.symbol}`} className="font-medium hover:text-blue-600">
                        {e.symbol}
                      </Link>
                      <div className="max-w-[180px] truncate text-[11px] text-slate-500 dark:text-slate-400">{e.company_name}</div>
                    </td>
                    <td className="max-w-[200px] py-2 pr-3">
                      <div>{e.purpose}</div>
                      {e.details && <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={e.details}>{e.details}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right">{price(e.last_close)}</td>
                    <td className="py-2 pr-3 text-right">{formatVolume(e.last_volume)}</td>
                    <td className="py-2 pr-3 text-right text-slate-500 dark:text-slate-400">{crore(e.avg_traded_value)}</td>
                    <td className="py-2 pr-3">
                      {signal ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${signal.className}`}>{signal.label}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`py-2 pr-3 text-right font-medium ${e.expected_return == null ? "text-slate-400" : e.expected_return >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {pct(e.expected_return)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-slate-500 dark:text-slate-400">{formatRange(e.likely_low, e.likely_high)}</td>
                    <td className="py-2 pr-3 text-right">{chance(e.chance_up)}</td>
                    <td className="py-2 pr-3 text-right">{chance(e.chance_down)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Model view is from the predictions made on {data.predictionDay ? formatDay(data.predictionDay) : "—"} (for the next trading day). Research only, not investment advice.
          </p>
        </div>
      )}
    </div>
  );
}

export default UpcomingResults;
