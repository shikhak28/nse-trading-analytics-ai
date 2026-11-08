/**
 * Shares to buy so that hitting the stop loses at most riskPercent of capital,
 * never more shares than the capital can pay for. Null when an input is missing.
 */
export function positionSize({ capital, riskPercent, stopPercent, entryPrice }) {
  if (!(capital > 0) || !(riskPercent > 0) || !(stopPercent > 0) || !(entryPrice > 0)) return null;

  const riskAmount = capital * (riskPercent / 100);
  const lossPerShare = entryPrice * (stopPercent / 100);
  const quantity = Math.min(Math.floor(riskAmount / lossPerShare), Math.floor(capital / entryPrice));
  return { quantity, riskAmount, cost: quantity * entryPrice };
}

export function dailyLossLimitHit({ dayPnl, capital, maxDailyLossPercent }) {
  if (dayPnl === null || !(capital > 0) || !(maxDailyLossPercent > 0)) return false;
  return dayPnl <= -capital * (maxDailyLossPercent / 100);
}

/** Kite's positions response: { day: [...], net: [...] }. */
export function sumDayPnl(positions) {
  const day = positions?.day;
  return Array.isArray(day) ? day.reduce((sum, position) => sum + Number(position.pnl || 0), 0) : null;
}
