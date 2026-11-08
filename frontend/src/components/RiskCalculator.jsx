import { useEffect, useMemo, useState } from "react";
import { portfolioApi } from "../api/portfolioApi";
import { dailyLossLimitHit, positionSize, sumDayPnl } from "../utils/risk";

const STORAGE_KEY = "risk_calculator";
const DEFAULTS = { capital: "", riskPercent: 1, maxDailyLossPercent: 3, manualStopPercent: 2 };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

const inr = (value) => `₹${Math.round(value).toLocaleString("en-IN")}`;

function RiskCalculator({ entryPrice, stopPercent, onUseQuantity, onDailyLimitChange, labelCls, inputCls }) {
  const [settings, setSettings] = useState(loadSettings);
  const [dayPnl, setDayPnl] = useState(null);
  const [pnlUnavailable, setPnlUnavailable] = useState(false);

  useEffect(() => {
    let ignore = false;
    portfolioApi
      .getPositions()
      .then((data) => {
        if (ignore) return;
        const pnl = data.success ? sumDayPnl(data.results) : null;
        setDayPnl(pnl);
        setPnlUnavailable(pnl === null);
      })
      .catch(() => {
        if (!ignore) setPnlUnavailable(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Only a convenience: the values still work for this visit.
    }
  };

  const capital = Number(settings.capital);
  // A single-leg GTT has no stop of its own, so the distance is entered here.
  const hasOwnStop = stopPercent !== null;
  const effectiveStop = Number(hasOwnStop ? stopPercent : settings.manualStopPercent);
  const size = useMemo(
    () => positionSize({ capital, riskPercent: Number(settings.riskPercent), stopPercent: effectiveStop, entryPrice }),
    [capital, settings.riskPercent, effectiveStop, entryPrice]
  );
  const limitHit = dailyLossLimitHit({ dayPnl, capital, maxDailyLossPercent: Number(settings.maxDailyLossPercent) });

  useEffect(() => {
    onDailyLimitChange(limitHit);
  }, [limitHit, onDailyLimitChange]);

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 p-2 space-y-2">
      <p className={labelCls}>Risk check</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>Capital ₹</label>
          <input type="number" min="0" value={settings.capital} onChange={(e) => update("capital", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Risk per trade %</label>
          <input type="number" min="0" step="0.1" value={settings.riskPercent} onChange={(e) => update("riskPercent", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Max day loss %</label>
          <input type="number" min="0" step="0.1" value={settings.maxDailyLossPercent} onChange={(e) => update("maxDailyLossPercent", e.target.value)} className={inputCls} />
        </div>
        {!hasOwnStop && (
          <div>
            <label className={labelCls}>Planned stop %</label>
            <input type="number" min="0" step="0.1" value={settings.manualStopPercent} onChange={(e) => update("manualStopPercent", e.target.value)} className={inputCls} />
          </div>
        )}
      </div>

      {size ? (
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          <span>
            Suggested <span className="font-semibold">{size.quantity}</span> shares · cost {inr(size.cost)} · max loss {inr(size.riskAmount)}
          </span>
          {size.quantity > 0 && (
            <button type="button" onClick={() => onUseQuantity(size.quantity)} className="text-blue-600 dark:text-blue-400 hover:underline">
              Use
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Enter capital and a stop %, with a stock selected, to size this trade.</p>
      )}

      {limitHit ? (
        <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
          Today's loss ({inr(dayPnl)}) has reached your limit. New BUY orders are blocked for today.
        </p>
      ) : pnlUnavailable ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Today's P&amp;L couldn't be read, so the daily loss limit isn't active.</p>
      ) : null}
    </div>
  );
}

export default RiskCalculator;
