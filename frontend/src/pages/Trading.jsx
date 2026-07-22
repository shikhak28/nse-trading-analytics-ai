import { useEffect, useState } from "react";
import { marketApi } from "../api/marketApi";
import { useLiveQuotes } from "../hooks/useLiveQuotes";

const SEARCH_DEBOUNCE_MS = 300;
const TABS = [
  { value: "create", label: "Create" },
  { value: "rules", label: "Rules" },
  { value: "gtts", label: "Active GTTs" },
  { value: "orders", label: "Orders" },
];

const inputCls =
  "w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 outline-none focus:border-blue-400 text-[11px] font-mono disabled:opacity-50";
const labelCls = "text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400";
const cardCls = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 shadow-sm";

const round2 = (value) => Number(value.toFixed(2));

function Trading() {
  const [tab, setTab] = useState("create");

  // --- symbol picker (shared by Create tab) ---
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);

  const liveQuotes = useLiveQuotes(selectedCompany ? [selectedCompany.symbol] : []);
  const ltp = selectedCompany ? liveQuotes[selectedCompany.symbol]?.ltp ?? null : null;

  // --- Create tab: which rule (if any) is driving this GTT ---
  const [selectedRuleId, setSelectedRuleId] = useState("custom");
  const [ruleType, setRuleType] = useState("single"); // 'single' | 'oco'
  const [transactionType, setTransactionType] = useState("BUY");
  const [priceMode, setPriceMode] = useState("percent"); // single only
  const [direction, setDirection] = useState("below"); // single only
  const [percentOffset, setPercentOffset] = useState(3); // single only
  const [customPrice, setCustomPrice] = useState(""); // single, custom mode only
  const [targetPercent, setTargetPercent] = useState(3); // oco only
  const [stoplossPercent, setStoplossPercent] = useState(2); // oco only
  const [orderType, setOrderType] = useState("LIMIT");
  const [product, setProduct] = useState("CNC");
  const [limitPrice, setLimitPrice] = useState(""); // single leg
  const [targetLimitPrice, setTargetLimitPrice] = useState(""); // oco target leg
  const [stoplossLimitPrice, setStoplossLimitPrice] = useState(""); // oco stoploss leg
  const [quantity, setQuantity] = useState(1);
  const isFromRule = selectedRuleId !== "custom";

  const [reviewing, setReviewing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState(null);
  const [modifyingTriggerId, setModifyingTriggerId] = useState(null);

  // --- Rules tab ---
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState(null);
  const [rfOpen, setRfOpen] = useState(false);
  const [rfEditingId, setRfEditingId] = useState(null);
  const [rfName, setRfName] = useState("");
  const [rfType, setRfType] = useState("single");
  const [rfTransactionType, setRfTransactionType] = useState("BUY");
  const [rfDirection, setRfDirection] = useState("below");
  const [rfPercentOffset, setRfPercentOffset] = useState(3);
  const [rfTargetPercent, setRfTargetPercent] = useState(3);
  const [rfStoplossPercent, setRfStoplossPercent] = useState(2);
  const [rfOrderType, setRfOrderType] = useState("LIMIT");
  const [rfProduct, setRfProduct] = useState("CNC");

  // --- Active GTTs tab ---
  const [gtts, setGtts] = useState([]);
  const [gttsLoading, setGttsLoading] = useState(true);
  const [gttsError, setGttsError] = useState(null);

  // --- Orders tab ---
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(null);

  const loadGtts = async () => {
    setGttsLoading(true);
    setGttsError(null);
    try {
      const data = await marketApi.getGTTs();
      if (data.success) setGtts(data.results || []);
      else setGttsError(data.message || "Unable to load GTTs.");
    } catch (err) {
      setGttsError(err.message || "Unable to load GTTs.");
    } finally {
      setGttsLoading(false);
    }
  };

  const loadRules = async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const data = await marketApi.getGttRules();
      if (data.success) setRules(data.results || []);
      else setRulesError(data.message || "Unable to load rules.");
    } catch (err) {
      setRulesError(err.message || "Unable to load rules.");
    } finally {
      setRulesLoading(false);
    }
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const data = await marketApi.getOrders();
      if (data.success) setOrders(data.results || []);
      else setOrdersError(data.message || "Unable to load orders.");
    } catch (err) {
      setOrdersError(err.message || "Unable to load orders.");
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      loadGtts();
      loadRules();
      loadOrders();
    }, 0);
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
        if (data.success) setSearchResults(data.results);
      } catch (err) {
        console.error("Failed to search companies", err);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, selectedCompany]);

  const applyRule = (ruleId) => {
    setSelectedRuleId(ruleId);
    if (ruleId === "custom") return;
    const rule = rules.find((r) => String(r.id) === String(ruleId));
    if (!rule) return;
    setRuleType(rule.rule_type);
    setTransactionType(rule.transaction_type);
    setOrderType(rule.order_type);
    setProduct(rule.product);
    setDirection(rule.direction || "below");
    setPercentOffset(Number(rule.percent_offset) || 3);
    setTargetPercent(Number(rule.target_percent) || 3);
    setStoplossPercent(Number(rule.stoploss_percent) || 2);
    setPriceMode("percent");
  };

  const isOco = ruleType === "oco";

  const singleTrigger =
    priceMode === "custom"
      ? Number(customPrice) || null
      : ltp
      ? round2(direction === "below" ? ltp * (1 - percentOffset / 100) : ltp * (1 + percentOffset / 100))
      : null;

  // OCO convention: SELL exits above (target) or below (stoploss) current price;
  // BUY entries are the mirror -- below (target/dip) or above (stoploss/breakout invalidated).
  const ocoTarget = ltp
    ? round2(transactionType === "SELL" ? ltp * (1 + targetPercent / 100) : ltp * (1 - targetPercent / 100))
    : null;
  const ocoStoploss = ltp
    ? round2(transactionType === "SELL" ? ltp * (1 - stoplossPercent / 100) : ltp * (1 + stoplossPercent / 100))
    : null;

  const resetForm = () => {
    setSelectedCompany(null);
    setSearch("");
    setSelectedRuleId("custom");
    setRuleType("single");
    setPriceMode("percent");
    setPercentOffset(3);
    setCustomPrice("");
    setTargetPercent(3);
    setStoplossPercent(2);
    setOrderType("LIMIT");
    setLimitPrice("");
    setTargetLimitPrice("");
    setStoplossLimitPrice("");
    setQuantity(1);
    setReviewing(false);
    setModifyingTriggerId(null);
  };

  const canReview = Boolean(
    selectedCompany &&
      quantity > 0 &&
      (isOco
        ? ocoTarget && ocoStoploss && (orderType === "MARKET" || (Number(targetLimitPrice) > 0 && Number(stoplossLimitPrice) > 0))
        : singleTrigger && (orderType === "MARKET" || Number(limitPrice) > 0))
  );

  const buildGttPayload = () => ({
    exchange: selectedCompany.exchange || "NSE",
    tradingsymbol: selectedCompany.symbol,
    trigger_type: isOco ? "two-leg" : "single",
    trigger_values: isOco ? [ocoTarget, ocoStoploss] : [singleTrigger],
    last_price: ltp,
    orders: isOco
      ? [
          { transaction_type: transactionType, order_type: orderType, product, quantity: Number(quantity), price: orderType === "LIMIT" ? Number(targetLimitPrice) : 0 },
          { transaction_type: transactionType, order_type: orderType, product, quantity: Number(quantity), price: orderType === "LIMIT" ? Number(stoplossLimitPrice) : 0 },
        ]
      : [{ transaction_type: transactionType, order_type: orderType, product, quantity: Number(quantity), price: orderType === "LIMIT" ? Number(limitPrice) : 0 }],
  });

  const handleConfirmPlace = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const payload = buildGttPayload();
      const data = modifyingTriggerId
        ? await marketApi.modifyGTT(modifyingTriggerId, payload)
        : await marketApi.createGTT(payload);

      if (data.success) {
        resetForm();
        loadGtts();
      } else {
        setPlaceError(data.message || "Unable to save GTT.");
      }
    } catch (err) {
      setPlaceError(err.response?.data?.message || err.message || "Unable to save GTT.");
    } finally {
      setPlacing(false);
    }
  };

  const handleCancelGtt = async (triggerId) => {
    if (!window.confirm(`Delete GTT #${triggerId}? This cannot be undone.`)) return;
    try {
      await marketApi.deleteGTT(triggerId);
      loadGtts();
    } catch (err) {
      alert(err.response?.data?.message || err.message || "Unable to delete GTT.");
    }
  };

  const handleModifyGtt = (gtt) => {
    const order = gtt.orders?.[0];
    const isTwoLeg = gtt.condition?.trigger_values?.length === 2;
    setTab("create");
    setSelectedCompany({ symbol: gtt.condition?.tradingsymbol, exchange: gtt.condition?.exchange || "NSE" });
    setSelectedRuleId("custom");
    setRuleType(isTwoLeg ? "oco" : "single");
    setTransactionType(order?.transaction_type || "BUY");
    setOrderType(order?.order_type || "LIMIT");
    setProduct(order?.product || "CNC");
    setQuantity(order?.quantity || 1);
    setPriceMode("custom");
    if (isTwoLeg) {
      setCustomPrice("");
      setTargetLimitPrice(String(gtt.orders?.[0]?.price ?? ""));
      setStoplossLimitPrice(String(gtt.orders?.[1]?.price ?? ""));
    } else {
      setCustomPrice(String(gtt.condition?.trigger_values?.[0] ?? ""));
      setLimitPrice(String(order?.price ?? ""));
    }
    setModifyingTriggerId(gtt.id);
    setReviewing(false);
  };

  const handleCancelOrder = async (order) => {
    if (!window.confirm(`Cancel order #${order.order_id}? This cannot be undone.`)) return;
    try {
      await marketApi.cancelOrder(order.variety, order.order_id);
      loadOrders();
    } catch (err) {
      alert(err.response?.data?.message || err.message || "Unable to cancel order.");
    }
  };

  const resetRuleForm = () => {
    setRfOpen(false);
    setRfEditingId(null);
    setRfName("");
    setRfType("single");
    setRfTransactionType("BUY");
    setRfDirection("below");
    setRfPercentOffset(3);
    setRfTargetPercent(3);
    setRfStoplossPercent(2);
    setRfOrderType("LIMIT");
    setRfProduct("CNC");
  };

  const openEditRule = (rule) => {
    setRfOpen(true);
    setRfEditingId(rule.id);
    setRfName(rule.name);
    setRfType(rule.rule_type);
    setRfTransactionType(rule.transaction_type);
    setRfDirection(rule.direction || "below");
    setRfPercentOffset(Number(rule.percent_offset) || 3);
    setRfTargetPercent(Number(rule.target_percent) || 3);
    setRfStoplossPercent(Number(rule.stoploss_percent) || 2);
    setRfOrderType(rule.order_type);
    setRfProduct(rule.product);
  };

  const handleSaveRule = async () => {
    if (!rfName.trim()) return;
    const payload = {
      name: rfName.trim(),
      rule_type: rfType,
      transaction_type: rfTransactionType,
      direction: rfType === "single" ? rfDirection : null,
      percent_offset: rfType === "single" ? rfPercentOffset : null,
      target_percent: rfType === "oco" ? rfTargetPercent : null,
      stoploss_percent: rfType === "oco" ? rfStoplossPercent : null,
      order_type: rfOrderType,
      product: rfProduct,
    };
    try {
      const data = rfEditingId
        ? await marketApi.updateGttRule(rfEditingId, payload)
        : await marketApi.createGttRule(payload);
      if (data.success) {
        resetRuleForm();
        loadRules();
      }
    } catch (err) {
      alert(err.response?.data?.message || err.message || "Unable to save rule.");
    }
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm("Delete this rule? Existing GTTs created from it are unaffected.")) return;
    try {
      await marketApi.deleteGttRule(id);
      loadRules();
    } catch (err) {
      alert(err.response?.data?.message || err.message || "Unable to delete rule.");
    }
  };

  return (
    <div className="p-6 text-slate-900 dark:text-slate-100">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Trading -- GTT Orders</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-[11px]">
          Real conditional orders on your live Zerodha account. Every create/modify/delete/cancel below requires a confirm step.
        </p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 -mb-px ${
              tab === item.value
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-3xl">
          <div className={`${cardCls} space-y-3`}>
            {!selectedCompany ? (
              <div>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search symbol..."
                  className={inputCls}
                />
                {searchResults.length > 0 && (
                  <div className="mt-1 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                    {searchResults.map((company) => (
                      <button
                        key={company.symbol}
                        onClick={() => {
                          setSelectedCompany(company);
                          setSearchResults([]);
                        }}
                        className="w-full text-left px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-semibold font-mono">{company.symbol}</span>{" "}
                        <span className="text-slate-500 dark:text-slate-400">{company.company_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5">
                <div>
                  <p className="font-semibold text-[11px] font-mono">{selectedCompany.symbol}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    LTP {ltp !== null ? ltp.toLocaleString("en-IN") : "..."}
                  </p>
                </div>
                <button onClick={resetForm} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                  change
                </button>
              </div>
            )}

            {selectedCompany && (
              <>
                <div>
                  <label className={labelCls}>Rule</label>
                  <select value={selectedRuleId} onChange={(event) => applyRule(event.target.value)} className={inputCls}>
                    <option value="custom">Custom</option>
                    {rules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Transaction</label>
                  <div className="flex gap-1 mt-1">
                    {["BUY", "SELL"].map((type) => (
                      <button
                        key={type}
                        onClick={() => !isFromRule && setTransactionType(type)}
                        disabled={isFromRule}
                        className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium border disabled:opacity-50 ${
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
                  <label className={labelCls}>Type</label>
                  <div className="flex gap-1 mt-1">
                    {["single", "oco"].map((type) => (
                      <button
                        key={type}
                        onClick={() => !isFromRule && setRuleType(type)}
                        disabled={isFromRule}
                        className={`flex-1 rounded-md px-2 py-1 text-[11px] border disabled:opacity-50 ${
                          ruleType === type
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {type === "single" ? "Single" : "OCO"}
                      </button>
                    ))}
                  </div>
                </div>

                {!isOco ? (
                  <div>
                    <label className={labelCls}>Trigger</label>
                    <div className="flex gap-1 mt-1 mb-1">
                      <button
                        onClick={() => !isFromRule && setPriceMode("percent")}
                        disabled={isFromRule}
                        className={`flex-1 rounded-md px-2 py-1 text-[10px] border disabled:opacity-50 ${priceMode === "percent" ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                      >
                        %
                      </button>
                      <button
                        onClick={() => !isFromRule && setPriceMode("custom")}
                        disabled={isFromRule}
                        className={`flex-1 rounded-md px-2 py-1 text-[10px] border disabled:opacity-50 ${priceMode === "custom" ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                      >
                        Price
                      </button>
                    </div>
                    {priceMode === "percent" ? (
                      <div className="flex gap-1 items-center">
                        <select value={direction} onChange={(event) => setDirection(event.target.value)} disabled={isFromRule} className={`${inputCls} w-20`}>
                          <option value="below">Below</option>
                          <option value="above">Above</option>
                        </select>
                        <input type="number" step="0.1" value={percentOffset} onChange={(event) => setPercentOffset(Number(event.target.value))} disabled={isFromRule} className={`${inputCls} w-16`} />
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">%</span>
                      </div>
                    ) : (
                      <input type="number" step="0.05" value={customPrice} onChange={(event) => setCustomPrice(event.target.value)} placeholder="Price" className={inputCls} />
                    )}
                    {singleTrigger && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">~{singleTrigger.toLocaleString("en-IN")}</p>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Target %</label>
                      <input type="number" step="0.1" value={targetPercent} onChange={(event) => setTargetPercent(Number(event.target.value))} disabled={isFromRule} className={inputCls} />
                      {ocoTarget && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">~{ocoTarget.toLocaleString("en-IN")}</p>}
                    </div>
                    <div>
                      <label className={labelCls}>Stoploss %</label>
                      <input type="number" step="0.1" value={stoplossPercent} onChange={(event) => setStoplossPercent(Number(event.target.value))} disabled={isFromRule} className={inputCls} />
                      {ocoStoploss && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">~{ocoStoploss.toLocaleString("en-IN")}</p>}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Order type</label>
                    <select value={orderType} onChange={(event) => setOrderType(event.target.value)} disabled={isFromRule} className={inputCls}>
                      <option value="LIMIT">LIMIT</option>
                      <option value="MARKET">MARKET</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Product</label>
                    <select value={product} onChange={(event) => setProduct(event.target.value)} disabled={isFromRule} className={inputCls}>
                      <option value="CNC">CNC</option>
                      <option value="MIS">MIS</option>
                      <option value="NRML">NRML</option>
                    </select>
                  </div>
                </div>

                {orderType === "LIMIT" &&
                  (isOco ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Target limit</label>
                        <input type="number" step="0.05" value={targetLimitPrice} onChange={(event) => setTargetLimitPrice(event.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Stoploss limit</label>
                        <input type="number" step="0.05" value={stoplossLimitPrice} onChange={(event) => setStoplossLimitPrice(event.target.value)} className={inputCls} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={labelCls}>Limit price</label>
                      <input type="number" step="0.05" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} className={inputCls} />
                    </div>
                  ))}

                <div>
                  <label className={labelCls}>Quantity</label>
                  <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={inputCls} />
                </div>

                <button
                  onClick={() => setReviewing(true)}
                  disabled={!canReview}
                  className="w-full rounded-md bg-blue-600 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                >
                  {modifyingTriggerId ? "Review changes" : "Review GTT"}
                </button>
                {modifyingTriggerId && (
                  <button onClick={resetForm} className="w-full text-[10px] text-slate-500 dark:text-slate-400 hover:underline">
                    cancel modify
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className={`${cardCls} max-w-2xl space-y-2`}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Saved rules</h2>
            {!rfOpen && (
              <button onClick={() => setRfOpen(true)} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                + new rule
              </button>
            )}
          </div>

          {rulesError && <p className="text-[11px] text-red-600 dark:text-red-400">{rulesError}</p>}
          {!rulesLoading && rules.length === 0 && !rfOpen && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">No saved rules yet.</p>
          )}

          <div className="space-y-1">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5 text-[11px]">
                <div>
                  <span className="font-semibold">{rule.name}</span>{" "}
                  <span className="text-slate-500 dark:text-slate-400 font-mono">
                    {rule.transaction_type} {rule.rule_type === "oco" ? `T${rule.target_percent}%/SL${rule.stoploss_percent}%` : `${rule.direction} ${rule.percent_offset}%`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEditRule(rule)} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                    edit
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id)} className="text-[10px] text-red-600 dark:text-red-400 hover:underline">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {rfOpen && (
            <div className="border-t border-slate-200 dark:border-slate-800 pt-2 mt-2 space-y-2">
              <input value={rfName} onChange={(event) => setRfName(event.target.value)} placeholder="Rule name" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <select value={rfTransactionType} onChange={(event) => setRfTransactionType(event.target.value)} className={inputCls}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select value={rfType} onChange={(event) => setRfType(event.target.value)} className={inputCls}>
                  <option value="single">Single</option>
                  <option value="oco">OCO</option>
                </select>
              </div>
              {rfType === "single" ? (
                <div className="flex gap-1 items-center">
                  <select value={rfDirection} onChange={(event) => setRfDirection(event.target.value)} className={`${inputCls} w-20`}>
                    <option value="below">Below</option>
                    <option value="above">Above</option>
                  </select>
                  <input type="number" step="0.1" value={rfPercentOffset} onChange={(event) => setRfPercentOffset(Number(event.target.value))} className={`${inputCls} w-16`} />
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">%</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Target %</label>
                    <input type="number" step="0.1" value={rfTargetPercent} onChange={(event) => setRfTargetPercent(Number(event.target.value))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Stoploss %</label>
                    <input type="number" step="0.1" value={rfStoplossPercent} onChange={(event) => setRfStoplossPercent(Number(event.target.value))} className={inputCls} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <select value={rfOrderType} onChange={(event) => setRfOrderType(event.target.value)} className={inputCls}>
                  <option value="LIMIT">LIMIT</option>
                  <option value="MARKET">MARKET</option>
                </select>
                <select value={rfProduct} onChange={(event) => setRfProduct(event.target.value)} className={inputCls}>
                  <option value="CNC">CNC</option>
                  <option value="MIS">MIS</option>
                  <option value="NRML">NRML</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={resetRuleForm} className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px]">
                  Cancel
                </button>
                <button onClick={handleSaveRule} className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500">
                  {rfEditingId ? "Save changes" : "Save rule"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "gtts" && (
        <div className={`${cardCls} max-w-3xl`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Active GTTs</h2>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{gttsLoading ? "..." : `${gtts.length} active`}</span>
          </div>
          {gttsError ? (
            <p className="text-[11px] text-red-600 dark:text-red-400 py-4 text-center">{gttsError}</p>
          ) : gtts.length === 0 && !gttsLoading ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 py-4 text-center">No active GTTs.</p>
          ) : (
            <div className="space-y-1">
              {gtts.map((gtt) => {
                const order = gtt.orders?.[0];
                return (
                  <div key={gtt.id} className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5 text-[11px]">
                    <div>
                      <span className="font-semibold font-mono">{gtt.condition?.tradingsymbol}</span>{" "}
                      <span className="text-slate-500 dark:text-slate-400">
                        {order?.transaction_type} x{order?.quantity} -- trigger {gtt.condition?.trigger_values?.join(" / ")} -- {gtt.status}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleModifyGtt(gtt)} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                        modify
                      </button>
                      <button onClick={() => handleCancelGtt(gtt.id)} className="text-[10px] text-red-600 dark:text-red-400 hover:underline">
                        delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className={`${cardCls} max-w-3xl`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Orders</h2>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{ordersLoading ? "..." : `${orders.length} today`}</span>
          </div>
          {ordersError ? (
            <p className="text-[11px] text-red-600 dark:text-red-400 py-4 text-center">{ordersError}</p>
          ) : orders.length === 0 && !ordersLoading ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 py-4 text-center">No orders today.</p>
          ) : (
            <div className="space-y-1">
              {orders.map((order) => {
                const cancellable = ["OPEN", "TRIGGER PENDING"].includes(order.status);
                return (
                  <div key={order.order_id} className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800/70 px-2 py-1.5 text-[11px]">
                    <div>
                      <span className="font-semibold font-mono">{order.tradingsymbol}</span>{" "}
                      <span className="text-slate-500 dark:text-slate-400">
                        {order.transaction_type} x{order.quantity} @ {order.price || order.average_price || "MKT"} -- {order.status}
                      </span>
                    </div>
                    {cancellable && (
                      <button onClick={() => handleCancelOrder(order)} className="text-[10px] text-red-600 dark:text-red-400 hover:underline">
                        cancel
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-sm w-full shadow-xl space-y-3">
            <h3 className="text-sm font-semibold">{modifyingTriggerId ? "Confirm GTT changes" : "Confirm GTT"}</h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              This places a real {isOco ? "two-leg OCO " : ""}GTT on your Zerodha account. It cannot be undone once triggered.
            </p>
            <div className="rounded-md bg-slate-50 dark:bg-slate-800/70 p-2 text-[11px] font-mono space-y-1">
              <p>
                {transactionType} {quantity} x {selectedCompany?.symbol}
              </p>
              {isOco ? (
                <>
                  <p>Target: {ocoTarget?.toLocaleString("en-IN")}</p>
                  <p>Stoploss: {ocoStoploss?.toLocaleString("en-IN")}</p>
                </>
              ) : (
                <p>Trigger {direction === "below" ? "<" : ">"} {singleTrigger?.toLocaleString("en-IN")}</p>
              )}
              <p>LTP: {ltp?.toLocaleString("en-IN")}</p>
              <p>
                {orderType} / {product}
              </p>
            </div>
            {placeError && <p className="text-[11px] text-red-600 dark:text-red-400">{placeError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setReviewing(false)} disabled={placing} className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px]">
                Back
              </button>
              <button onClick={handleConfirmPlace} disabled={placing} className="flex-1 rounded-md bg-blue-600 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500">
                {placing ? "Placing..." : modifyingTriggerId ? "Confirm & Save" : "Confirm & Place"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Trading;
