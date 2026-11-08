import { useEffect, useState } from "react";
import { predictionsApi } from "../api/predictionsApi";
import { PRICE_BANDS } from "../utils/priceBands";

// Predictions before this used day-old features, so they don't describe the
// model as it runs now. The date box can still look further back.
const FIRST_CORRECTED_PREDICTION_DAY = "2026-11-09";
const MIN_DAYS_TO_TRUST = 20;

const pct = (value, digits = 2) =>
  value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;

const cell = "p-3 border-b border-slate-100 dark:border-slate-800/70 whitespace-nowrap";
const headCell = "p-3 border-b border-slate-200 dark:border-slate-800 font-medium whitespace-nowrap";

function PriceGroupPerformance() {
  const [from, setFrom] = useState(FIRST_CORRECTED_PREDICTION_DAY);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    predictionsApi
      .getPriceGroupPerformance(from)
      .then((data) => {
        if (ignore) return;
        setResult(data.success ? data.results : null);
        setError(data.success ? null : data.message || "Unable to load price group results.");
      })
      .catch((err) => {
        if (!ignore) setError(err.message || "Unable to load price group results.");
      });
    return () => {
      ignore = true;
    };
  }, [from]);

  const rows = PRICE_BANDS.map((band) => ({
    band,
    stats: result?.groups.find((group) => group.band === band.value),
  })).filter((row) => row.stats);

  return (
    <div className="mt-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Performance by Price Group</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Expected-move model, verified next-day results. "vs market" compares with that day's average stock.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !result ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No verified predictions from this date yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className={headCell}>Group</th>
                <th className={headCell}>Days</th>
                <th className={headCell}>Direction correct</th>
                <th className={headCell}>Rank correlation</th>
                <th className={headCell}>Top {result.topN} Rise: actual</th>
                <th className={headCell}>vs market</th>
                <th className={headCell}>Top {result.topN} Fall: actual</th>
                <th className={headCell}>vs market</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ band, stats }) => (
                <tr key={band.value}>
                  <td className={cell}>
                    <span className="font-medium">{band.label}</span>
                    {stats.days < MIN_DAYS_TO_TRUST && (
                      <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Low sample
                      </span>
                    )}
                  </td>
                  <td className={cell}>{stats.days}</td>
                  <td className={cell}>{(stats.direction_correct * 100).toFixed(1)}%</td>
                  <td className={cell}>{stats.rank_correlation === null ? "—" : stats.rank_correlation.toFixed(3)}</td>
                  <td className={cell}>{pct(stats.rise_actual)}</td>
                  <td className={cell}>{pct(stats.rise_vs_market)}</td>
                  <td className={cell}>{pct(stats.fall_actual)}</td>
                  <td className={cell}>{pct(stats.fall_vs_market)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PriceGroupPerformance;
