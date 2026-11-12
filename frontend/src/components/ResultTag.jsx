import { formatDay } from "../utils/tradingDays";

// "RESULT 14 Nov" next to a stock whose quarterly results are due within
// 30 days (from the uploaded NSE Event Calendar). Amber when 3 days or less:
// moves around results are big and hard to predict.
export function ResultTag({ stock }) {
  if (!stock?.next_result_date) return null;
  const soon = stock.next_result_days <= 3;
  const when = stock.next_result_days === 0 ? "today" : stock.next_result_days === 1 ? "tomorrow" : `in ${stock.next_result_days} days`;
  return (
    <span
      className={`ml-1 whitespace-nowrap rounded px-1 text-[10px] font-semibold ${
        soon ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
      }`}
      title={`Quarterly results ${when}. Price can move a lot around results; the model doesn't know the numbers.`}
    >
      RESULT {formatDay(stock.next_result_date)}
    </span>
  );
}
