import { useEffect, useState } from "react";
import axios from "axios";

// Upload a company's results PDF; Gemini reads it and explains it in simple
// Hinglish, next to what our model says about the stock.

const VERDICT = {
  strong: { label: "Strong result", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  mixed: { label: "Mixed result", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  weak: { label: "Weak result", cls: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
};

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const growth = (v) =>
  v == null ? (
    <span className="text-slate-400">—</span>
  ) : (
    <span className={v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );

function Reading({ data }) {
  const r = data.reading;
  const g = data.growth;
  const v = VERDICT[r.verdict] || VERDICT.mixed;
  const m = data.modelView;
  const rows = [
    { label: "Revenue", now: r.revenue, prev: r.revenue_prev_year, yoy: g.revenueYoY, qoq: g.revenueQoQ },
    { label: "Net profit", now: r.net_profit, prev: r.net_profit_prev_year, yoy: g.profitYoY, qoq: g.profitQoQ },
    { label: "EPS (₹)", now: r.eps, prev: r.eps_prev_year, yoy: g.epsYoY, qoq: null },
  ];
  return (
    <div className="mt-6 grid gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">
              {r.company} <span className="text-sm font-normal text-slate-500">({data.symbol})</span>
            </h2>
            <p className="text-sm text-slate-500">
              {r.period_label}
              {r.consolidated != null && <> · {r.consolidated ? "Consolidated" : "Standalone"}</>} · figures in {r.unit}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${v.cls}`}>{v.label}</span>
        </div>
        <p className="mt-3 text-base">{r.summary}</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{r.verdict_reason}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-4 py-2 font-medium" />
              <th className="px-3 py-2 text-right font-medium">This period</th>
              <th className="px-3 py-2 text-right font-medium">Last year</th>
              <th className="px-3 py-2 text-right font-medium">vs last year</th>
              <th className="px-3 py-2 text-right font-medium">vs last quarter</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2 font-medium">{row.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(row.now)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{fmt(row.prev)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{growth(row.yoy)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{growth(row.qoq)}</td>
              </tr>
            ))}
            {r.operating_margin_pct != null && (
              <tr className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2 font-medium">Operating margin</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(r.operating_margin_pct)}%</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                  {r.operating_margin_prev_year_pct == null ? "—" : `${fmt(r.operating_margin_prev_year_pct)}%`}
                </td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">{data.lang === "hinglish" ? "Achhi baatein" : "Good points"}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {r.good_points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-semibold text-red-700 dark:text-red-400">{data.lang === "hinglish" ? "Chinta ki baatein" : "Concerns"}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {r.concerns.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </div>

      {m && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-semibold">What our model says (prediction of {m.day})</h3>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            Expected move <b className="font-mono">{m.expected >= 0 ? "+" : ""}{m.expected}%</b> · chance of rising 2%+{" "}
            <b className="font-mono">{m.chanceUp2}%</b> · chance of falling 2%+ <b className="font-mono">{m.chanceDown2}%</b>
            {m.signal && m.signal !== "none" && <> · signal <b>{m.signal}</b></>}
            {!m.liquid && <> · not a liquid stock</>}
          </p>
          <p className="mt-1 text-xs text-slate-500">The model does not read results yet; this is its price-based view.</p>
        </div>
      )}
      <p className="text-xs text-slate-500">
        {data.hasFile && (
          <>
            <a href={`/api/reports/${data.id}/file`} className="text-blue-600 hover:underline dark:text-blue-400">
              Download the original file
            </a>
            {" · "}
          </>
        )}
        Read by {data.model}
        {data.cached && " (this PDF was read before; showing the saved reading)"}. AI can misread a table: check key numbers in the
        PDF. Not investment advice.
      </p>
    </div>
  );
}

function ResultsReader() {
  const [symbol, setSymbol] = useState("");
  const [file, setFile] = useState(null);
  const [lang, setLang] = useState("english");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = () =>
    axios
      .get("/api/reports")
      .then(({ data }) => setHistory(data.success ? data.results : []))
      .catch(() => {});
  useEffect(() => {
    loadHistory();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!symbol.trim() || !file) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await axios.post("/api/reports/explain", file, {
        params: { symbol: symbol.trim().toUpperCase(), name: file.name, lang },
        headers: {
          "Content-Type": /\.xml$/i.test(file.name) ? "application/xml" : /\.html?$/i.test(file.name) ? "text/html" : "application/pdf",
        },
        timeout: 240000,
      });
      if (data.success) {
        setCurrent(data.result);
        loadHistory();
      } else setError(data.message);
    } catch (err) {
      setError(err.response?.data?.message || (err.response?.status === 413 ? "File too big (max 20 MB)." : err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 text-slate-900 sm:p-8 dark:text-slate-100">
      <h1 className="text-3xl font-semibold">Results Reader</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        Upload a company's quarterly results: the PDF, or NSE's XBRL (.xml) or iXBRL (.html) file. AI reads it and explains the numbers in simple
        words, next to our model's view. Every report is saved below, with its original file.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="NSE symbol, e.g. TCS"
          aria-label="NSE symbol"
          className="w-48 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm uppercase dark:border-slate-700 dark:bg-slate-900"
        />
        <input
          type="file"
          accept=".pdf,.xml,.html,.htm,application/pdf,application/xml,text/xml,text/html"
          aria-label="Results PDF or XBRL file"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm dark:file:bg-slate-800 dark:file:text-slate-200"
        />
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Language"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="english">English</option>
          <option value="hinglish">Hinglish</option>
        </select>
        <button
          type="submit"
          disabled={busy || !symbol.trim() || !file}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Reading… (up to a minute)" : "Explain"}
        </button>
      </form>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {current && <Reading data={current} />}

      {history.length > 0 && (
        <div className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">All saved reports ({history.length})</h2>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by symbol"
              aria-label="Filter saved reports by symbol"
              className="w-44 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm uppercase dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {history
              .filter((h) => !filter.trim() || h.symbol.startsWith(filter.trim().toUpperCase()))
              .map((h) => {
                const v = VERDICT[h.reading.verdict] || VERDICT.mixed;
                return (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <button type="button" onClick={() => setCurrent(h)} className="min-w-0 text-left hover:text-blue-600">
                      <b>{h.symbol}</b> · {h.reading.period_label}
                      <span className="ml-2 text-xs text-slate-500">
                        {h.lang === "hinglish" ? "Hinglish" : "English"} · read {new Date(h.createdAt).toLocaleDateString("en-IN")}
                      </span>
                    </button>
                    <span className="flex items-center gap-3">
                      {h.hasFile && (
                        <a href={`/api/reports/${h.id}/file`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                          File
                        </a>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.cls}`}>{v.label}</span>
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ResultsReader;
