import { useEffect, useState } from "react";
import { marketApi } from "../api/marketApi";
import { useLiveQuotes } from "../hooks/useLiveQuotes";

const SEARCH_DEBOUNCE_MS = 300;

function Trading() {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);

  const [transactionType, setTransactionType] = useState("BUY");
  const [priceMode, setPriceMode] = useState("percent");
  const [direction, setDirection] = useState("below");
  const [percentOffset, setPercentOffset] = useState(3);
  const [customPrice, setCustomPrice] = useState("");
  const [orderType, setOrderType] = useState("LIMIT");
  const [limitPrice, setLimitPrice] = useState("");
  const [product, setProduct] = useState("CNC");
  const [quantity, setQuantity] = useState(1);

  const [reviewing, setReviewing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState(null);

  const [gtts, setGtts] = useState([]);
  const [gttsLoading, setGttsLoading] = useState(true);
  const [gttsError, setGttsError] = useState(null);

  const liveQuotes = useLiveQuotes(selectedCompany ? [selectedCompany.symbol] : []);
  const ltp = selectedCompany ? liveQuotes[selectedCompany.symbol]?.ltp ?? null : null;

  const triggerPrice =
    priceMode === "custom"
      ? Number(customPrice) || null
      : ltp
      ? Number((direction === "below" ? ltp * (1 - percentOffset / 100) : ltp * (1 + percentOffset / 100)).toFixed(2))
      : null;

  const loadGtts = async () => {
    setGttsLoading(true);
    setGttsError(null);
    try {
      const data = await marketApi.getGTTs();
      if (data.success) {
        setGtts(data.results || []);
      } else {
        setGttsError(data.message || "Unable to load GTTs.");
      }
    } catch (err) {
      setGttsError(err.message || "Unable to load GTTs.");
    } finally {
      setGttsLoading(false);
    }
  };

  useEffect(() => {
    const handle = setTimeout(loadGtts, 0);
    return () => clearTimeout(handle);
  }, []);

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!search || selectedCompany) {
        setSearchResults([]);
        return;
      }

      try {
        const data = await marketApi.getCompanies({ search, limit: 10 });
        if (data.success) {
          setSearchResults(data.results);
        }
      } catch (err) {
        console.error("Failed to search companies", err);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [search, selectedCompany]);

  const resetForm = () => {
    setSelectedCompany(null);
    setSearch("");
    setPriceMode("percent");
    setPercentOffset(3);
    setCustomPrice("");
    setOrderType("LIMIT");
    setLimitPrice("");
    setQuantity(1);
    setReviewing(false);
  };

  const canReview = selectedCompany && triggerPrice && quantity > 0 && (orderType === "MARKET" || Number(limitPrice) > 0);

  const handleConfirmPlace = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const data = await marketApi.createGTT({
        exchange: selectedCompany.exchange || "NSE",
        tradingsymbol: selectedCompany.symbol,
        trigger_type: "single",
        trigger_values: [triggerPrice],
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
      });

      if (data.success) {
        resetForm();
        loadGtts();
      } else {
        setPlaceError(data.message || "Unable to place GTT.");
      }
    } catch (err) {
      setPlaceError(err.response?.data?.message || err.message || "Unable to place GTT.");
    } finally {
      setPlacing(false);
    }
  };

  const handleCancelGtt = async (triggerId) => {
    if (!window.confirm(`Cancel GTT #${triggerId}? This cannot be undone.`)) {
      return;
    }
    try {
      await marketApi.deleteGTT(triggerId);
      loadGtts();
    } catch (err) {
      alert(err.response?.data?.message || err.message || "Unable to cancel GTT.");
    }
  };

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">GTT Orders</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-xs">
          Create Good-Till-Triggered orders on your live Zerodha account -- these place real orders when triggered.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Create GTT</h2>

          {!selectedCompany ? (
            <div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search company..."
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2 outline-none focus:border-blue-400 text-sm"
              />
              {searchResults.length > 0 && (
                <div className="mt-2 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {searchResults.map((company) => (
                    <button
                      key={company.symbol}
                      onClick={() => {
                        setSelectedCompany(company);
                        setSearchResults([]);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="font-semibold">{company.symbol}</span>{" "}
                      <span className="text-slate-500 dark:text-slate-400">{company.company_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/70 px-4 py-3">
              <div>
                <p className="font-semibold text-sm">{selectedCompany.symbol}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  LTP: {ltp !== null ? ltp.toLocaleString("en-IN") : "waiting for tick..."}
                </p>
              </div>
              <button onClick={resetForm} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                Change
              </button>
            </div>
          )}

          {selectedCompany && (
            <>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Transaction</label>
                <div className="flex gap-2 mt-1">
                  {["BUY", "SELL"].map((type) => (
                    <button
                      key={type}
                      onClick={() => setTransactionType(type)}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium border ${
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
              </div>

              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Trigger price</label>
                <div className="flex gap-2 mt-1 mb-2">
                  <button
                    onClick={() => setPriceMode("percent")}
                    className={`flex-1 rounded-xl px-3 py-1.5 text-xs border ${priceMode === "percent" ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                  >
                    % from current
                  </button>
                  <button
                    onClick={() => setPriceMode("custom")}
                    className={`flex-1 rounded-xl px-3 py-1.5 text-xs border ${priceMode === "custom" ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                  >
                    Custom price
                  </button>
                </div>

                {priceMode === "percent" ? (
                  <div className="flex gap-2 items-center">
                    <select
                      value={direction}
                      onChange={(event) => setDirection(event.target.value)}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-2 text-sm"
                    >
                      <option value="below">Below</option>
                      <option value="above">Above</option>
                    </select>
                    <input
                      type="number"
                      step="0.1"
                      value={percentOffset}
                      onChange={(event) => setPercentOffset(Number(event.target.value))}
                      className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                    />
                    <span className="text-sm text-slate-500 dark:text-slate-400">%</span>
                  </div>
                ) : (
                  <input
                    type="number"
                    step="0.05"
                    value={customPrice}
                    onChange={(event) => setCustomPrice(event.target.value)}
                    placeholder="Trigger price"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                  />
                )}
                {triggerPrice && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Trigger at ~{triggerPrice.toLocaleString("en-IN")}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400">Order type</label>
                  <select
                    value={orderType}
                    onChange={(event) => setOrderType(event.target.value)}
                    className="w-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="LIMIT">LIMIT</option>
                    <option value="MARKET">MARKET</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400">Product</label>
                  <select
                    value={product}
                    onChange={(event) => setProduct(event.target.value)}
                    className="w-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="CNC">CNC</option>
                    <option value="MIS">MIS</option>
                    <option value="NRML">NRML</option>
                  </select>
                </div>
              </div>

              {orderType === "LIMIT" && (
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400">Limit price</label>
                  <input
                    type="number"
                    step="0.05"
                    value={limitPrice}
                    onChange={(event) => setLimitPrice(event.target.value)}
                    className="w-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="w-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                />
              </div>

              <button
                onClick={() => setReviewing(true)}
                disabled={!canReview}
                className="w-full rounded-xl bg-blue-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Review GTT
              </button>
            </>
          )}
        </div>

        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Active GTTs</h2>
            <span className="text-slate-500 dark:text-slate-400 text-[12px]">
              {gttsLoading ? "Loading..." : `${gtts.length} active`}
            </span>
          </div>

          {gttsError ? (
            <div className="py-10 text-center text-red-600 dark:text-red-400 text-sm">{gttsError}</div>
          ) : gtts.length === 0 && !gttsLoading ? (
            <div className="py-10 text-center text-slate-500 dark:text-slate-400 text-sm">No active GTTs.</div>
          ) : (
            <div className="space-y-2">
              {gtts.map((gtt) => {
                const order = gtt.orders?.[0];
                return (
                  <div
                    key={gtt.id}
                    className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/70 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">
                        {gtt.condition?.tradingsymbol}{" "}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          {order?.transaction_type} x{order?.quantity}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Trigger: {gtt.condition?.trigger_values?.join(", ")} -- status: {gtt.status}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCancelGtt(gtt.id)}
                      className="rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {reviewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Confirm GTT</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This places a real GTT on your Zerodha account. It cannot be undone once triggered.
            </p>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-sm space-y-1">
              <p>
                <span className="font-semibold">{transactionType}</span> {quantity} x {selectedCompany?.symbol}
              </p>
              <p>Triggers when price goes {direction === "below" ? "below" : "above"} {triggerPrice?.toLocaleString("en-IN")}</p>
              <p>Current LTP: {ltp?.toLocaleString("en-IN")}</p>
              <p>
                {orderType} order, product {product}
                {orderType === "LIMIT" ? `, limit price ${limitPrice}` : ""}
              </p>
            </div>
            {placeError && <p className="text-sm text-red-600 dark:text-red-400">{placeError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setReviewing(false)}
                disabled={placing}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPlace}
                disabled={placing}
                className="flex-1 rounded-xl bg-blue-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                {placing ? "Placing..." : "Confirm & Place GTT"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Trading;
