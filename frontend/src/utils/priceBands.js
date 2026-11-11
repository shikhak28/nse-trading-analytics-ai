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
