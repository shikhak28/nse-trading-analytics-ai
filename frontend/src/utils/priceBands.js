// Sections by last daily close (₹). min is inclusive, max exclusive. A stock
// with no recent close has no known section.
export const PRICE_BANDS = [
  { value: "penny", label: "Penny", range: "under ₹500", min: 0, max: 500 },
  { value: "mid", label: "Mid", range: "₹500–5,000", min: 500, max: 5000 },
  { value: "upper", label: "Upper", range: "₹5,000–10,000", min: 5000, max: 10000 },
  { value: "high_risk", label: "High Risk", range: "₹10,000+", min: 10000, max: Infinity },
];

export function matchesBand(stock, band) {
  if (stock.last_close === null || stock.last_close === undefined) return false;
  const price = Number(stock.last_close);
  return price >= band.min && price < band.max;
}

/**
 * The API returns one row per stock per model target; this folds them into
 * one record per stock. Rows arrive newest first, so if the models ran twice
 * that day the latest value wins. Stocks with no return estimate are dropped,
 * since they have no expected move to show.
 */
export function mergeStockPredictions(rows) {
  const stocks = new Map();
  for (const row of rows) {
    const key = `${row.exchange}:${row.symbol}`;
    if (!stocks.has(key)) {
      stocks.set(key, {
        exchange: row.exchange,
        symbol: row.symbol,
        company_name: row.company_name,
        last_close: row.last_close,
        targets: {},
      });
    }
    const { targets } = stocks.get(key);
    if (!(row.target_label in targets)) targets[row.target_label] = Number(row.predicted_value);
  }

  return [...stocks.values()]
    .filter((stock) => "next_day_return" in stock.targets)
    .map(({ targets, ...stock }) => ({
      ...stock,
      expected_return: targets.next_day_return,
      chance_up: targets.p_move_up_2pct ?? null,
      chance_down: targets.p_move_down_2pct ?? null,
    }));
}
