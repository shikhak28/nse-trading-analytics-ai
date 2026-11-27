import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDay } from "../utils/tradingDays";

// Stocks that rose 5% to 20% in a day, and what the model said about them the
// evening before -- to study the moves the model missed and why.

const UNIVERSES = [
  { key: "liquid", label: "Liquid only" },
  { key: "all", label: "All stocks" },
];

const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

function rankTone(rank) {
  if (rank == null) return "text-slate-400";
  if (rank <= 20) return "text-emerald-600 dark:text-emerald-400";
  if (rank <= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function BigMovers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [day, setDay] = useState("");
  const [universe, setUniverse] = useState("liquid");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    axios
      .get("/api/predictions/big-movers", { params: day ? { day } : {} })
      .then(({ data }) => {
        if (ignore) return;
        if (data.success) setData(data);
        else setError(data.message || "Could not load big movers.");
      })
      .catch((err) => !ignore && setError(err.response?.data?.message || "Could not load big movers."))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, [day]);

  const rows = useMemo(() => (data ? data.movers.filter((m) => universe === "all" || m.liquid) : []), [data, universe]);
  const rankOf = (m) => (universe === "liquid" ? m.rankUp2Liquid : m.rankUp2);
  const s = data?.summary;

  return (
    <div className="mx-auto max-w-6xl p-4 text-slate-900 sm:p-8 dark:text-slate-100">
      <h1 className="text-3xl font-semibold">Big Movers</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        Stocks that rose 5% to 20% in one day, and where the model ranked them the evening before. Rank is the stock's place in the
        Rise 2%+ list (1 = top pick).
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-500 dark:text-slate-400" htmlFor="bm-day">
          Prediction made on
        </label>
        <select
          id="bm-day"
          value={day || data?.day || ""}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {(data?.days || []).map((d) => (
            <option key={d} value={d}>
              {formatDay(d)}
            </option>
          ))}
        </select>
        <div className="flex gap-2" role="group" aria-label="Stocks">
          {UNIVERSES.map((u) => (
            <button
              key={u.key}
              type="button"
              aria-pressed={universe === u.key}
              onClick={() => setUniverse(u.key)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                universe === u.key
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              }`}
            >
              {u.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {data && !loading && (
        <>
          {s && (
            <p className="mt-6 text-base">
              {data.resultDay ? <>On <b>{formatDay(data.resultDay)}</b>, </> : null}
              <b className="font-mono">{s.liquid}</b> liquid stocks (of {s.liquidUniverse}) rose 5–20%
              {s.total > s.liquid && <> ({s.total} counting all stocks)</>}. The model had <b className="font-mono">{s.liquidInTop20 ?? 0}</b> of them in
              its liquid top 20 and <b className="font-mono">{s.liquidInTop50 ?? 0}</b> in its top 50.
              {s.top20Cutoff != null && (
                <>
                  {" "}
                  To make the top 20 a stock needed a Rise 2%+ chance of at least <b className="font-mono">{s.top20Cutoff.toFixed(0)}%</b>.
                </>
              )}
            </p>
          )}

          {!rows.length ? (
            <p className="mt-4 text-sm italic text-slate-500">No stock rose 5–20% that day.</p>
          ) : (
            <>
              {/* Phones */}
              <div className="mt-3 grid gap-3 sm:hidden">
                {rows.map((m) => (
                  <div key={m.symbol} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{m.symbol}</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{signed(m.actual)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        Rank <b className={`font-mono ${rankTone(rankOf(m))}`}>{rankOf(m) ?? "—"}</b>
                      </span>
                      <span>
                        Chance 2%+ <b className="font-mono text-slate-700 dark:text-slate-200">{m.chanceUp2 == null ? "—" : `${m.chanceUp2.toFixed(0)}%`}</b>
                      </span>
                      <span>
                        Expected <b className="font-mono text-slate-700 dark:text-slate-200">{signed(m.expected)}</b>
                      </span>
                      <span>
                        Gap <b className="font-mono text-slate-700 dark:text-slate-200">{signed(m.gap)}</b>
                      </span>
                      <span>
                        Volume <b className="font-mono text-slate-700 dark:text-slate-200">{m.volumeX == null ? "—" : `${m.volumeX}x`}</b>
                      </span>
                    </div>
                    {m.reasons.length > 0 && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{m.reasons.join(" · ")}</p>}
                  </div>
                ))}
              </div>

              {/* Tablets and up */}
              <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">Stock</th>
                      <th className="px-3 py-2 text-right font-medium">Rose</th>
                      <th className="px-3 py-2 text-right font-medium">Model rank</th>
                      <th className="px-3 py-2 text-right font-medium">Chance 2%+</th>
                      <th className="px-3 py-2 text-right font-medium">Chance 4%+</th>
                      <th className="px-3 py-2 text-right font-medium">Expected</th>
                      <th className="px-3 py-2 text-right font-medium">Gap at open</th>
                      <th className="px-3 py-2 text-right font-medium">Volume</th>
                      <th className="px-3 py-2 font-medium">Likely reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.symbol} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2">
                          <span className="font-semibold">{m.symbol}</span>
                          {m.sector && <span className="block text-xs text-slate-500">{m.sector}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{signed(m.actual)}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${rankTone(rankOf(m))}`}>{rankOf(m) ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{m.chanceUp2 == null ? "—" : `${m.chanceUp2.toFixed(0)}%`}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{m.chanceUp4 == null ? "—" : `${m.chanceUp4.toFixed(0)}%`}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{signed(m.expected)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{signed(m.gap)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{m.volumeX == null ? "—" : `${m.volumeX}x`}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{m.reasons.join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default BigMovers;
