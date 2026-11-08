import nseHolidays from "../../../shared/nse_holidays.json";

// Local (not UTC) YYYY-MM-DD -- toISOString() would roll back to the
// previous day in IST before 5:30 AM.
function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIso() {
  return toIsoDate(new Date());
}

// Same holiday list the cron's trading_calendar.py guard reads.
const NSE_HOLIDAYS = new Set(
  Object.entries(nseHolidays)
    .filter(([key]) => !key.startsWith("_"))
    .flatMap(([, days]) => days)
);

export function isTradingDay(d) {
  return d.getDay() !== 0 && d.getDay() !== 6 && !NSE_HOLIDAYS.has(toIsoDate(d));
}

// The date picker is the trading day being *predicted*; predict.py runs at
// 6 PM on the previous trading day, so that's the predicted_at date to query.
// Skips weekends and NSE holidays (e.g. Monday -> Friday).
export function previousTradingDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  do {
    d.setDate(d.getDate() - 1);
  } while (!isTradingDay(d));
  return toIsoDate(d);
}

export function formatDay(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
