import { useEffect, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

const card = "rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm";

function pct(value, digits = 1) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

// Plain-words verdict for one signal's hit rate. 50% is a coin toss; with
// few calls, anything is noise.
function verdict(stats) {
  if (!stats || stats.n < 30) return { text: "Too few calls yet", className: "text-slate-500 dark:text-slate-400" };
  if (stats.hit_rate >= 0.55) return { text: "Better than a coin toss", className: "text-emerald-600 dark:text-emerald-400" };
  if (stats.hit_rate > 0.5) return { text: "Barely better than a coin toss", className: "text-amber-600 dark:text-amber-400" };
  return { text: "Not better than a coin toss", className: "text-red-600 dark:text-red-400" };
}

function SignalRow({ label, labelClass, stats, cost, direction }) {
  const v = verdict(stats);
  // What a trade in the signal's direction earned on average, after cost.
  const net = stats?.avg_return == null ? null : direction * stats.avg_return - cost;
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className={`py-2 pr-3 font-medium ${labelClass}`}>{label}</td>
      <td className="py-2 pr-3 text-right">{stats?.n ?? 0}</td>
      <td className="py-2 pr-3 text-right text-sm font-semibold">{pct(stats?.hit_rate)}</td>
      <td className="py-2 pr-3 text-right">{signedPct(stats?.avg_return)}</td>
      <td className={`py-2 pr-3 text-right ${net == null ? "" : net > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
        {signedPct(net)}
      </td>
      <td className={`py-2 text-xs ${v.className}`}>{v.text}</td>
    </tr>
  );
}

function SignalReportCard() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [scope, setScope] = useState("liquid");

  useEffect(() => {
    predictionsApi
      .getSignalAccuracy()
      .then((res) => (res.success ? setReport(res.results) : setError(res.message || "Unable to load signal report.")))
      .catch((err) => setError(err.message || "Unable to load signal report."));
  }, []);

  const data = report?.[scope];

  return (
    <div className={`${card} mb-6 p-6`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Signal report card</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            How often the Price Groups <span className="font-medium">Signal</span> was right the next day. Positive is right when
            the stock rose, Negative when it fell. 50% = coin toss. Days with stale data are left out.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-full border border-slate-200 text-sm dark:border-slate-800">
          {[
            { value: "liquid", label: "Liquid stocks" },
            { value: "all", label: "All stocks" },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setScope(o.value)}
              className={`px-4 py-2 ${scope === o.value ? "bg-blue-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : !report ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Signal</th>
                  <th className="pb-2 pr-3 text-right font-medium">Calls</th>
                  <th className="pb-2 pr-3 text-right font-medium">Right</th>
                  <th className="pb-2 pr-3 text-right font-medium">Avg next-day move</th>
                  <th className="pb-2 pr-3 text-right font-medium">Avg profit after cost</th>
                  <th className="pb-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                <SignalRow label="Positive" labelClass="text-emerald-600 dark:text-emerald-400" stats={data.positive} cost={report.tradingCost} direction={1} />
                <SignalRow label="Negative" labelClass="text-red-600 dark:text-red-400" stats={data.negative} cost={report.tradingCost} direction={-1} />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Based on {report.days.length} trading day{report.days.length === 1 ? "" : "s"}
            {report.days.length ? ` (${report.days[0]} to ${report.days[report.days.length - 1]})` : ""}. Profit assumes buying on
            Positive / selling on Negative at the close, minus {pct(report.tradingCost, 1)} trading cost. Trust it only after
            many weeks of results.
          </p>
        </>
      )}
    </div>
  );
}

export default SignalReportCard;
