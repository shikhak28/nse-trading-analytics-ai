import { useEffect, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

const TARGET_META = {
  next_day_return: { label: "Predicted Next-Day Return", isReturn: true },
  eod_return: { label: "Predicted Today's Intraday Return", isReturn: true },
  p_move_up_2pct: { label: "Likely to Rise ≥2%", isReturn: false },
  p_move_down_2pct: { label: "Likely to Fall ≥2%", isReturn: false },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPercent(value, digits) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function groupByTarget(predictions) {
  const groups = {};
  for (const row of predictions) {
    if (!groups[row.target_label]) groups[row.target_label] = [];
    groups[row.target_label].push(row);
  }
  for (const rows of Object.values(groups)) {
    rows.sort((a, b) => Number(b.predicted_value) - Number(a.predicted_value));
  }
  return groups;
}

function Predictions() {
  const [date, setDate] = useState(todayIso());
  const [horizon, setHorizon] = useState("next_day");
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadPredictions = async () => {
      setLoading(true);
      try {
        const data = await predictionsApi.getPredictions({ horizon, date });
        if (data.success) {
          setPredictions(data.results);
          setError(null);
        } else {
          setError(data.message || "Unable to load predictions.");
        }
      } catch (err) {
        setError(err.message || "Unable to load predictions.");
      } finally {
        setLoading(false);
      }
    };

    loadPredictions();
  }, [horizon, date]);

  const groups = groupByTarget(predictions);
  const targetsForHorizon =
    horizon === "eod"
      ? ["eod_return"]
      : ["next_day_return", "p_move_up_2pct", "p_move_down_2pct"];

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Predictions</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Model-generated predictions for the selected date.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setHorizon("next_day")}
              className={`px-4 py-2 ${
                horizon === "next_day"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
              }`}
            >
              Next Day
            </button>
            <button
              type="button"
              onClick={() => setHorizon("eod")}
              className={`px-4 py-2 ${
                horizon === "eod"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
              }`}
            >
              Today (EOD)
            </button>
          </div>

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading predictions...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {targetsForHorizon.map((target) => {
            const meta = TARGET_META[target];
            const rows = groups[target] || [];
            return (
              <div key={target}>
                <h2 className="mb-2 text-lg font-medium">{meta.label}</h2>
                <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
                  {rows.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                      No predictions for this date yet.
                    </div>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400 text-sm">
                          <th className="p-4 border-b border-slate-200 dark:border-slate-800">Symbol</th>
                          <th className="p-4 border-b border-slate-200 dark:border-slate-800">Exchange</th>
                          <th className="p-4 border-b border-slate-200 dark:border-slate-800">
                            {meta.isReturn ? "Predicted Return" : "Probability"}
                          </th>
                          <th className="p-4 border-b border-slate-200 dark:border-slate-800">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={`${row.exchange}-${row.symbol}`} className="text-sm">
                            <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{row.symbol}</td>
                            <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{row.exchange}</td>
                            <td
                              className={`p-4 border-b border-slate-100 dark:border-slate-800/70 ${
                                meta.isReturn
                                  ? Number(row.predicted_value) >= 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400"
                                  : ""
                              }`}
                            >
                              {formatPercent(row.predicted_value, meta.isReturn ? 2 : 1)}
                            </td>
                            <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">
                              {formatPercent(row.confidence, 1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Predictions;
