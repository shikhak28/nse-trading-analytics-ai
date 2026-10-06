import { useEffect, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";

const TARGET_LABEL_NAMES = {
  next_day_return: "Next-Day Return",
  p_move_up_2pct: "Likely to Rise",
  p_move_down_2pct: "Likely to Fall",
  eod_return: "Intraday (EOD) Return",
};

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

const STATUS_BADGE = {
  production: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  shadow: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  retired: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
  rolled_back: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
};

function ModelCard({ model }) {
  const backtest = model.metrics?.backtest || {};
  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 overflow-hidden">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{TARGET_LABEL_NAMES[model.target_label] || model.target_label}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={model.version_tag}>
            {model.horizon} · {model.version_tag}
          </div>
        </div>
        <span className={`flex-shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[model.status] || STATUS_BADGE.shadow}`}>
          {model.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-slate-500 dark:text-slate-400">Overall IC</div>
          <div className="font-semibold">{formatNumber(model.metrics?.overall_ic)}</div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-400">Sharpe ({backtest.side || "—"})</div>
          <div className="font-semibold">{formatNumber(backtest.sharpe, 2)}</div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-400">Max Drawdown</div>
          <div className="font-semibold">{formatPercent(backtest.max_drawdown)}</div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-400">Profit Factor</div>
          <div className="font-semibold">{formatNumber(backtest.profit_factor, 2)}</div>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 dark:border-slate-800/70 pt-3 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
        <div>Backtest window: {backtest.n_days ?? "—"} days (naive, no transaction costs)</div>
        <div>Trained on: {formatDate(model.train_window_start)} – {formatDate(model.train_window_end)}</div>
        <div>Trained at: {formatDateTime(model.trained_at)}</div>
      </div>
    </div>
  );
}

function ModelHealth() {
  const [currentModels, setCurrentModels] = useState([]);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [current, history] = await Promise.all([
          predictionsApi.getCurrentModel(),
          predictionsApi.getModelVersions(),
        ]);
        if (current.success) setCurrentModels(current.results);
        if (history.success) setVersions(history.results);
        if (!current.success || !history.success) {
          setError(current.message || history.message || "Unable to load model data.");
        } else {
          setError(null);
        }
      } catch (err) {
        setError(err.message || "Unable to load model data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Model Health</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Current production models and full training history. Promotion is manual by design -- there's no button here.
        </p>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          Loading model data...
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <>
          <h2 className="mb-3 text-base font-medium">Current Production Models</h2>
          {currentModels.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-sm text-slate-500 dark:text-slate-400">
              No model is currently promoted to production.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {currentModels.map((model) => (
                <ModelCard key={model.id} model={model} />
              ))}
            </div>
          )}

          <h2 className="mt-8 mb-3 text-base font-medium">Version History</h2>
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 text-sm">
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">ID</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Target</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Horizon</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Status</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Overall IC</th>
                  <th className="p-4 border-b border-slate-200 dark:border-slate-800">Trained At</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="text-sm">
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{v.id}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{TARGET_LABEL_NAMES[v.target_label] || v.target_label}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{v.horizon}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[v.status] || STATUS_BADGE.shadow}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatNumber(v.metrics?.overall_ic)}</td>
                    <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{formatDateTime(v.trained_at)}</td>
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

export default ModelHealth;
