import { useEffect, useState } from "react";
import { marketApi } from "../api/marketApi";
import { useLiveQuotes } from "../hooks/useLiveQuotes";

const inputCls =
  "w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 outline-none focus:border-blue-400 text-[11px] font-mono disabled:opacity-50";
const labelCls = "text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400";

const round2 = (value) => Number(value.toFixed(2));
const formatNumber = (value) =>
  value === null || value === undefined ? "-" : Number(value).toLocaleString("en-IN");
// Explicit timeZone: "Asia/Kolkata" so this always reads as IST regardless
// of the browser's own local timezone (Kite's tick timestamps are IST).
const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "-";

/**
 * Row-click popup: live quote + circuit limits + recent daily candles for one
 * company, plus a slimmed single-trigger Create GTT form. Deliberately not
 * sharing state/JSX with Trading.jsx's full Create tab (OCO, rule templates,
 * modify-in-place) -- that page is tightly coupled to its own tab state, and
 * this popup only ever needs the common case: one symbol, one trigger.
 */
export function CompanyDetailModal({ company, onClose }) {
  const liveQuotes = useLiveQuotes(company ? [company.symbol] : []);
  const quote = company ? liveQuotes[company.symbol] : null;
  const ltp = quote?.ltp ?? company?.last_close ?? null;

  const [candles, setCandles] = useState([]);
  const [candlesLoading, setCandlesLoading] = useState(true);

  const [transactionType, setTransactionType] = useState("BUY");
  const [direction, setDirection] = useState("below");
  const [percentOffset, setPercentOffset] = useState(3);
  const [orderType, setOrderType] = useState("LIMIT");
  const [product, setProduct] = useState("CNC");
  const [limitPrice, setLimitPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [showGttForm, setShowGttForm] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState(null);
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    if (!company) return;

    const loadCandles = async () => {
      setCandles([]);
      setCandlesLoading(true);
      const from = new Date();
      from.setDate(from.getDate() - 10);

      try {
        const data = await marketApi.fetchStoredHistorical(company.symbol, "day", from.toISOString(), undefined);
        if (data.success) setCandles(data.results.slice(-5).reverse());
      } catch (err) {
        console.error("Failed to load recent candles", err);
      } finally {
        setCandlesLoading(false);
      }
    };

    loadCandles();
  }, [company]);

  if (!company) return null;

  const trigger = ltp
    ? round2(direction === "below" ? ltp * (1 - percentOffset / 100) : ltp * (1 + percentOffset / 100))
    : null;

  const canReview = Boolean(trigger && quantity > 0 && (orderType === "MARKET" || Number(limitPrice) > 0));

  const handleConfirmPlace = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const payload = {
        exchange: company.exchange || "NSE",
        tradingsymbol: company.symbol,
        trigger_type: "single",
        trigger_values: [trigger],
        last_price: ltp,
        orders: [
          {
            transaction_type: transactionType,
            order_type: orderType,
            product,
            quantity: Number(quantity),
            price: orderType === "LIMIT" ? Number(limitPrice) : 0,
          },
        ],
      };
      const data = await marketApi.createGTT(payload);
      if (data.success) {
        setPlaced(true);
        setReviewing(false);
      } else {
        setPlaceError(data.message || "Unable to place GTT.");
      }
    } catch (err) {
      setPlaceError(err.response?.data?.message || err.message || "Unable to place GTT.");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-md w-full shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold font-mono">{company.symbol}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{company.company_name} &middot; {company.exchange}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none">
            &times;
          </button>
        </div>

        <div className="rounded-md bg-slate-50 dark:bg-slate-800/70 p-2 text-[11px] grid grid-cols-2 gap-y-1">
          <span className="text-slate-500 dark:text-slate-400">LTP</span>
          <span className="text-right font-semibold">{formatNumber(ltp)}</span>
          <span className="text-slate-500 dark:text-slate-400">Change</span>
          <span className={`text-right font-semibold ${quote?.change_percent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {quote?.change_percent !== undefined && quote?.change_percent !== null ? `${quote.change_percent >= 0 ? "+" : ""}${Number(quote.change_percent).toFixed(2)}%` : "-"}
          </span>
          <span className="text-slate-500 dark:text-slate-400">Volume</span>
          <span className="text-right">{formatNumber(quote?.volume ?? company.last_volume)}</span>
          <span className="text-slate-500 dark:text-slate-400">Upper circuit</span>
          <span className="text-right text-emerald-600 dark:text-emerald-400">
            {formatNumber(quote?.upper_circuit_limit)}
            {quote?.upper_circuit_percent != null && ` (+${Number(quote.upper_circuit_percent).toFixed(2)}%)`}
          </span>
          <span className="text-slate-500 dark:text-slate-400">Lower circuit</span>
          <span className="text-right text-red-600 dark:text-red-400">
            {formatNumber(quote?.lower_circuit_limit)}
            {quote?.lower_circuit_percent != null && ` (${Number(quote.lower_circuit_percent).toFixed(2)}%)`}
          </span>
          <span className="text-slate-500 dark:text-slate-400">Updated</span>
          <span className="text-right">{formatDateTime(quote?.updated_at)}</span>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Recent candles</h4>
          {candlesLoading ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Loading...</p>
          ) : candles.length === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">No stored history yet.</p>
          ) : (
            <div className="space-y-0.5">
              {candles.map((candle) => (
                <div key={candle.date} className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  <span>{candle.date.slice(0, 10)}</span>
                  <span>O {formatNumber(candle.open)}</span>
                  <span>H {formatNumber(candle.high)}</span>
                  <span>L {formatNumber(candle.low)}</span>
                  <span>C {formatNumber(candle.close)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {placed ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">GTT placed successfully.</p>
        ) : !showGttForm ? (
          <button
            onClick={() => setShowGttForm(true)}
            className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
          >
            Create GTT
          </button>
        ) : (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-2">
            <div className="flex gap-1">
              {["BUY", "SELL"].map((type) => (
                <button
                  key={type}
                  onClick={() => setTransactionType(type)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium border ${
                    transactionType === type
                      ? type === "BUY"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "bg-red-600 border-red-600 text-white"
                      : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="flex gap-1 items-center">
              <select value={direction} onChange={(event) => setDirection(event.target.value)} className={`${inputCls} w-24`}>
                <option value="below">Below</option>
                <option value="above">Above</option>
              </select>
              <input type="number" step="0.1" value={percentOffset} onChange={(event) => setPercentOffset(Number(event.target.value))} className={`${inputCls} w-16`} />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">%</span>
              {trigger && <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto">~{trigger.toLocaleString("en-IN")}</span>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Order type</label>
                <select value={orderType} onChange={(event) => setOrderType(event.target.value)} className={inputCls}>
                  <option value="LIMIT">LIMIT</option>
                  <option value="MARKET">MARKET</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Product</label>
                <select value={product} onChange={(event) => setProduct(event.target.value)} className={inputCls}>
                  <option value="CNC">CNC</option>
                  <option value="MIS">MIS</option>
                  <option value="NRML">NRML</option>
                </select>
              </div>
            </div>

            {orderType === "LIMIT" && (
              <div>
                <label className={labelCls}>Limit price</label>
                <input type="number" step="0.05" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} className={inputCls} />
              </div>
            )}

            <div>
              <label className={labelCls}>Quantity</label>
              <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputCls} />
            </div>

            <button
              onClick={() => setReviewing(true)}
              disabled={!canReview}
              className="w-full rounded-md bg-blue-600 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
            >
              Review GTT
            </button>
          </div>
        )}

        {reviewing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setReviewing(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-sm w-full shadow-xl space-y-3" onClick={(event) => event.stopPropagation()}>
              <h3 className="text-sm font-semibold">Confirm GTT</h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                This places a real GTT on your Zerodha account. It cannot be undone once triggered.
              </p>
              <div className="rounded-md bg-slate-50 dark:bg-slate-800/70 p-2 text-[11px] font-mono space-y-1">
                <p>{transactionType} {quantity} x {company.symbol}</p>
                <p>Trigger {direction === "below" ? "<" : ">"} {trigger?.toLocaleString("en-IN")}</p>
                <p>LTP: {ltp?.toLocaleString("en-IN")}</p>
                <p>{orderType} / {product}</p>
              </div>
              {placeError && <p className="text-[11px] text-red-600 dark:text-red-400">{placeError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setReviewing(false)} disabled={placing} className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px]">
                  Back
                </button>
                <button onClick={handleConfirmPlace} disabled={placing} className="flex-1 rounded-md bg-blue-600 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500">
                  {placing ? "Placing..." : "Confirm & Place"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
