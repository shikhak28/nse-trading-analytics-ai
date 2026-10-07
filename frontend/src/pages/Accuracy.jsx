import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
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

const CLASSIFICATION_TARGETS = [
  { value: "p_move_up_2pct", label: "Likely to Rise" },
  { value: "p_move_down_2pct", label: "Likely to Fall" },
];

// Probabilities rarely reach 50% for a >=2% move (see Predictions.jsx's
// confidence tiers), so a 0.5 cutoff would just predict "no" for everything.
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.5];

const CalibrationTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  if (point.n === undefined) return null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-700 dark:text-slate-200">
        Bin {point.bin}: {formatPercent(point.min_predicted)}–{formatPercent(point.max_predicted)}
      </p>
      <p className="text-slate-500 dark:text-slate-400">Mean predicted: {formatPercent(point.mean_predicted)}</p>
      <p className="text-slate-500 dark:text-slate-400">Actually moved: {formatPercent(point.observed_rate)}</p>
      <p className="text-slate-500 dark:text-slate-400">Predictions: {point.n}</p>
    </div>
  );
};

function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-4 py-2 ${value === o.value ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

function ConfusionMatrix({ summary }) {
  const { tp, fp, fn, tn, n } = summary;
  const cells = [
    { key: "tp", label: "True positive", sub: "flagged, did move", count: tp },
    { key: "fp", label: "False positive", sub: "flagged, didn't move", count: fp },
    { key: "fn", label: "False negative", sub: "missed a real move", count: fn },
    { key: "tn", label: "True negative", sub: "not flagged, didn't move", count: tn },
  ];
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-0.5 text-xs">
      <div />
      <div className="px-2 pb-1 text-center text-slate-500 dark:text-slate-400">Actually moved</div>
      <div className="px-2 pb-1 text-center text-slate-500 dark:text-slate-400">Didn't move</div>
      {[cells.slice(0, 2), cells.slice(2)].map((row, i) => (
        <div key={i} className="contents">
          <div className="flex items-center pr-2 text-right text-slate-500 dark:text-slate-400">
            {i === 0 ? "Model flagged" : "Not flagged"}
          </div>
          {row.map((c) => {
            const share = n ? c.count / n : 0;
            return (
              <div
                key={c.key}
                title={`${c.label}: ${c.count} (${formatPercent(share)} of all)`}
                className="relative rounded-lg px-3 py-4 text-center overflow-hidden"
              >
                {/* Single-hue sequential shading by share of total; text stays in ink colors. */}
                <div
                  className="absolute inset-0 bg-blue-600 dark:bg-blue-500"
                  style={{ opacity: 0.08 + 0.6 * Math.sqrt(share) }}
                />
                <div className="relative">
                  <div className="text-lg font-semibold">{c.count.toLocaleString()}</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">{c.label}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">{c.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ClassificationPanel({ horizon }) {
  const [targetLabel, setTargetLabel] = useState("p_move_up_2pct");
  const [threshold, setThreshold] = useState(0.1);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getClassificationMetrics({ horizon, targetLabel, threshold, bins: 10 });
        if (data.success) {
          setMetrics(data.results);
          setError(null);
        } else {
          setError(data.message || "Unable to load calibration data.");
        }
      } catch (err) {
        setError(err.response?.data?.message || err.message || "Unable to load calibration data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [horizon, targetLabel, threshold]);

  const bins = (metrics?.bins || []).map((b) => ({
    ...b,
    mean_predicted: Number(b.mean_predicted),
    observed_rate: Number(b.observed_rate),
  }));
  // Shared x/y scale so the y = x "perfectly calibrated" line is a true diagonal.
  const axisMax = Math.min(
    1,
    Math.ceil((Math.max(0.05, ...bins.map((b) => Math.max(b.mean_predicted, b.observed_rate))) * 1.1) * 20) / 20
  );
  const summary = metrics?.summary;

  return (
    <div className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Calibration &amp; Confusion Matrix</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            When the model says 12%, does the stock actually move ≥2% about 12% of the time?
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup options={CLASSIFICATION_TARGETS} value={targetLabel} onChange={setTargetLabel} />
          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Flag at ≥
            <select
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {THRESHOLDS.map((t) => (
                <option key={t} value={t}>
                  {(t * 100).toFixed(0)}%
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading calibration data...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : !summary || summary.n === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-sm text-slate-500 dark:text-slate-400">
          No verified predictions yet for this target.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Verified predictions" value={summary.n.toLocaleString()} />
            <Stat label="Base rate" value={formatPercent(summary.base_rate)} hint="share that actually moved ≥2%" />
            <Stat
              label="Brier score"
              value={Number(summary.brier).toFixed(4)}
              hint={`always-guess-base-rate: ${(Number(summary.base_rate) * (1 - Number(summary.base_rate))).toFixed(4)}`}
            />
            <Stat label="Precision" value={formatPercent(summary.precision)} hint={`of flagged at ≥${(threshold * 100).toFixed(0)}%`} />
            <Stat label="Recall" value={formatPercent(summary.recall)} hint="of real moves caught" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
              <h3 className="text-sm font-medium">Calibration curve</h3>
              <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
                {bins.length} equal-count bins · dashed line = perfectly calibrated
              </p>
              <div className="h-72 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bins} margin={{ top: 10, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      type="number"
                      dataKey="mean_predicted"
                      domain={[0, axisMax]}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fontSize: 11 }}
                      label={{ value: "Predicted probability", position: "insideBottom", offset: -10, fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      domain={[0, axisMax]}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fontSize: 11 }}
                      width={50}
                      label={{ value: "Actually moved", angle: -90, position: "insideLeft", fontSize: 11 }}
                    />
                    <ReferenceLine
                      segment={[{ x: 0, y: 0 }, { x: axisMax, y: axisMax }]}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                    <Tooltip content={<CalibrationTooltip />} />
                    <Line
                      type="linear"
                      dataKey="observed_rate"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 4, strokeWidth: 0, fill: "#2563eb" }}
                      activeDot={{ r: 6 }}
                      isAnimationActive
                      animationDuration={400}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Show bins as a table</summary>
                <table className="mt-2 w-full border-collapse">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400">
                      <th className="py-1">Bin</th>
                      <th className="py-1">Range</th>
                      <th className="py-1">Mean predicted</th>
                      <th className="py-1">Actually moved</th>
                      <th className="py-1">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bins.map((b) => (
                      <tr key={b.bin}>
                        <td className="py-1">{b.bin}</td>
                        <td className="py-1">{formatPercent(b.min_predicted)}–{formatPercent(b.max_predicted)}</td>
                        <td className="py-1">{formatPercent(b.mean_predicted)}</td>
                        <td className="py-1">{formatPercent(b.observed_rate)}</td>
                        <td className="py-1">{b.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>

            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
              <h3 className="text-sm font-medium">Confusion matrix</h3>
              <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
                "Flagged" = predicted probability ≥ {(threshold * 100).toFixed(0)}%
              </p>
              <ConfusionMatrix summary={summary} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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

      <ClassificationPanel horizon={horizon} />
    </div>
  );
}

export default Accuracy;
