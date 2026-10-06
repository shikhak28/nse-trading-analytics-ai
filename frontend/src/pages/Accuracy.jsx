import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { predictionsApi } from "../api/predictionsApi";

const TARGET_LABELS = [
  { value: "", label: "All Targets" },
  { value: "next_day_return", label: "Next-Day Return" },
  { value: "p_move_up_2pct", label: "Likely to Rise" },
  { value: "p_move_down_2pct", label: "Likely to Fall" },
  { value: "eod_return", label: "Intraday (EOD) Return" },
];

function formatBucket(value, groupBy) {
  const date = new Date(value);
  return groupBy === "month"
    ? date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

const ChartTooltip = ({ active, payload, groupBy }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{formatBucket(point.bucket, groupBy)}</p>
      <p className="text-slate-500 dark:text-slate-400">Hit rate: {formatPercent(point.hit_rate)}</p>
      <p className="text-slate-500 dark:text-slate-400">Predictions: {point.n}</p>
    </div>
  );
};

function Accuracy() {
  const [horizon, setHorizon] = useState("next_day");
  const [targetLabel, setTargetLabel] = useState("");
  const [groupBy, setGroupBy] = useState("day");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getAccuracy({ horizon, targetLabel: targetLabel || undefined, groupBy });
        if (data.success) {
          setRows([...data.results].reverse());
          setError(null);
        } else {
          setError(data.message || "Unable to load accuracy data.");
        }
      } catch (err) {
        setError(err.message || "Unable to load accuracy data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [horizon, targetLabel, groupBy]);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Accuracy</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Real verified hit-rate over time -- not training-time IC, actual outcomes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setHorizon("next_day")}
              className={`px-4 py-2 ${horizon === "next_day" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              Next Day
            </button>
            <button
              type="button"
              onClick={() => setHorizon("eod")}
              className={`px-4 py-2 ${horizon === "eod" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              EOD
            </button>
          </div>

          <select
            value={targetLabel}
            onChange={(e) => setTargetLabel(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          >
            {TARGET_LABELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setGroupBy("day")}
              className={`px-4 py-2 ${groupBy === "day" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("month")}
              className={`px-4 py-2 ${groupBy === "month" ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
            >
              Monthly
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading accuracy data...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-sm text-slate-500 dark:text-slate-400">
          No verified predictions yet for this filter -- check back once verify.py has had more days to accumulate results.
        </div>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={(v) => formatBucket(v, groupBy)}
                    tick={{ fontSize: 11 }}
                    minTickGap={30}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                    tick={{ fontSize: 11 }}
                    width={50}
                  />
                  <Tooltip content={<ChartTooltip groupBy={groupBy} />} />
                  <Line
                    type="monotone"
                    dataKey="hit_rate"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                    isAnimationActive
                    animationDuration={400}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 text-sm">
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Date</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Predictions</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Hit Rate</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Mean Error</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Mean Realized Return</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.bucket} className="text-sm">
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatBucket(row.bucket, groupBy)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{row.n}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.hit_rate)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.mean_error)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatPercent(row.mean_realized_return)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default Accuracy;
