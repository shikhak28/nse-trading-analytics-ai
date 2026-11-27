import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDay } from "../utils/tradingDays";

// Stocks locked at a 5%, 10% or 20% upper circuit over the last 10 trading days,
// and what the model said about them the evening before.

const BANDS = [
  { key: "all", label: "All (5%, 10%, 20%)" },
  { key: "20", label: "20%" },
  { key: "10", label: "10%" },
  { key: "5", label: "5%" },
];
const UNIVERSES = [
  { key: "all", label: "All stocks" },
  { key: "liquid", label: "Liquid only" },
];

const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const money = (v) => (v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const chance = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

function rankTone(rank) {
  if (rank == null) return "text-slate-400";
  if (rank <= 20) return "text-emerald-600 dark:text-emerald-400";
  if (rank <= 100) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function Pills({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
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

function UpperCircuit() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [band, setBand] = useState("all");
  const [universe, setUniverse] = useState("all");

  useEffect(() => {
    let ignore = false;
    axios
      .get("/api/predictions/upper-circuit")
      .then(({ data }) => {
        if (ignore) return;
        if (data.success) setData(data);
        else setError(data.message || "Could not load upper circuits.");
      })
      .catch((err) => !ignore && setError(err.response?.data?.message || "Could not load upper circuits."));
    return () => {
      ignore = true;
    };
  }, []);

  const byDay = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter((r) => (band === "all" || String(r.band) === band) && (universe === "all" || r.liquid));
    return data.days.map((day) => ({ day, rows: rows.filter((r) => r.day === day) }));
  }, [data, band, universe]);
  const total = byDay.reduce((n, d) => n + d.rows.length, 0);
  const inTop20 = byDay.reduce((n, d) => n + d.rows.filter((r) => r.rankUp4 != null && r.rankUp4 <= 20).length, 0);

  return (
    <div className="mx-auto max-w-6xl p-4 text-slate-900 sm:p-8 dark:text-slate-100">
      <h1 className="text-3xl font-semibold">Upper Circuit</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        Stocks that closed locked at a 5%, 10% or 20% upper circuit in the last 10 trading days, and what the model said the evening
        before: its confidence (chance of rising 4%+ and 2%+) and its rank in the Rise 4%+ list (1 = top). Stocks that touched the circuit and fell back
        are not included.
      </p>

      <div className="mt-6 grid gap-3">
        <Pills label="Circuit" options={BANDS} value={band} onChange={setBand} />
        <Pills label="Stocks" options={UNIVERSES} value={universe} onChange={setUniverse} />
      </div>

      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {!data && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <p className="mt-6 text-base">
            <b className="font-mono">{total}</b> upper circuits in {data.days.length} trading days. The model had{" "}
            <b className="font-mono">{inTop20}</b> of them in its Rise 4%+ top 20 the evening before.
          </p>

          <div className="mt-3 grid gap-4">
            {byDay.map(({ day, rows }) => (
              <section key={day} className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <header className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                  <h2 className="font-semibold">{formatDay(day)}</h2>
                  <span className="text-xs text-slate-500">
                    {rows.length} stock{rows.length === 1 ? "" : "s"}
                  </span>
                </header>
                {!rows.length ? (
                  <p className="px-4 py-3 text-sm italic text-slate-500">None.</p>
                ) : (
                  <>
                    {/* Phones */}
                    <ul className="divide-y divide-slate-100 sm:hidden dark:divide-slate-800">
                      {rows.map((r) => (
                        <li key={r.symbol} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-semibold">{r.symbol}</span>
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {r.band}% circuit
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span>
                              Close <b className="font-mono text-slate-700 dark:text-slate-200">{money(r.close)}</b>
                            </span>
                            <span>
                              Confidence 4%+ <b className="font-mono text-slate-700 dark:text-slate-200">{chance(r.chanceUp4)}</b>
                            </span>
                            <span>
                              Confidence 2%+ <b className="font-mono text-slate-700 dark:text-slate-200">{chance(r.chanceUp2)}</b>
                            </span>
                            <span>
                              Rank <b className={`font-mono ${rankTone(r.rankUp4)}`}>{r.rankUp4 ?? "—"}</b>
                            </span>
                            <span>
                              Expected <b className="font-mono text-slate-700 dark:text-slate-200">{signed(r.expected)}</b>
                            </span>
                            {r.liquid && <span className="font-medium text-blue-600 dark:text-blue-400">Liquid</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {/* Tablets and up */}
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[820px] border-collapse text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <th className="px-4 py-2 font-medium">Stock</th>
                            <th className="px-3 py-2 font-medium">Circuit</th>
                            <th className="px-3 py-2 text-right font-medium">Prev close</th>
                            <th className="px-3 py-2 text-right font-medium">Close</th>
                            <th className="px-3 py-2 text-right font-medium">Confidence 4%+</th>
                            <th className="px-3 py-2 text-right font-medium">Confidence 2%+</th>
                            <th className="px-3 py-2 text-right font-medium">Model rank</th>
                            <th className="px-3 py-2 text-right font-medium">Expected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.symbol} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-4 py-2">
                                <span className="font-semibold">{r.symbol}</span>
                                {r.liquid && <span className="ml-2 text-xs font-medium text-blue-600 dark:text-blue-400">Liquid</span>}
                                <span className="block max-w-[260px] truncate text-xs text-slate-500">{r.sector || r.company}</span>
                              </td>
                              <td className="px-3 py-2 font-medium text-emerald-600 dark:text-emerald-400">{r.band}%</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.prevClose)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.close)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{chance(r.chanceUp4)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{chance(r.chanceUp2)}</td>
                              <td className={`px-3 py-2 text-right font-mono tabular-nums ${rankTone(r.rankUp4)}`}>{r.rankUp4 ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{signed(r.expected)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default UpperCircuit;
