const columns = "grid grid-cols-[1.8fr_0.9fr_0.8fr_0.9fr_1.1fr_1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr] items-center gap-3";

const formatNumber = (value) =>
  value === null || value === undefined ? "-" : Number(value).toLocaleString("en-IN");

// Depth/quantity fields default to 0 (not "-") when no live data has arrived
// yet -- e.g. outside market hours -- per request: show zero, not a blank dash.
const formatZero = (value) =>
  Number(value ?? 0).toLocaleString("en-IN");

const formatPercent = (value) =>
  value === null || value === undefined ? "-" : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;

const formatDate = (value) => (value ? value.slice(0, 10) : "-");

const formatTime = (value) => (value ? new Date(value).toLocaleTimeString("en-IN") : "-");

export function CompanyRowHeader() {
  return (
    <div className={`${columns} px-3 py-3 text-slate-500 dark:text-slate-400 border-b border-slate-300 dark:border-slate-700 text-[12px] font-medium`}>
      <span>Company</span>
      <span>LTP</span>
      <span>Change</span>
      <span>Volume</span>
      <span>Best Bid</span>
      <span>Best Ask</span>
      <span>Buy Qty</span>
      <span>Sell Qty</span>
      <span>Circuit (U/L)</span>
      <span>Updated</span>
      <span>Status</span>
    </div>
  );
}

export function CompanyRow({ index, style, companies, quotes = {}, onRowClick }) {
  const company = companies[index];
  const quote = quotes[company.symbol];

  const ltp = quote?.ltp ?? company.last_close ?? company.close;
  // Falls back to a persisted daily-movers snapshot's change_percent (see
  // dailyMovers.service.js) when viewing a past day and there's no live tick.
  const changePercent = quote?.change_percent ?? company.change_percent;
  const volume = quote?.volume ?? company.last_volume ?? company.volume;
  const isLive = Boolean(quote);

  // depth is only ever present on live ticks (full mode) -- never on stored
  // history, so these always fall back to 0 until a tick with depth arrives.
  const bestBid = quote?.depth?.buy?.[0];
  const bestAsk = quote?.depth?.sell?.[0];
  const buyQty = quote?.total_buy_quantity ?? company.total_buy_quantity;
  const sellQty = quote?.total_sell_quantity ?? company.total_sell_quantity;
  const upperCircuit = quote?.upper_circuit_limit;
  const lowerCircuit = quote?.lower_circuit_limit;
  const updatedAt = quote?.updated_at;

  return (
    <div
      style={style}
      onClick={() => onRowClick?.(company)}
      className={`${columns} px-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 transition text-[12px] cursor-pointer`}
    >
      <div className="min-w-0">
        <p className="font-bold text-xs truncate text-slate-800 dark:text-slate-100">{company.symbol}</p>
        <p className="text-slate-500 dark:text-slate-400 text-[12px] truncate">{company.company_name}</p>
      </div>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{formatNumber(ltp)}</span>
      <span className={changePercent >= 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : changePercent < 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-400"}>
        {formatPercent(changePercent)}
      </span>
      <span className="text-slate-600 dark:text-slate-300">{formatNumber(volume)}</span>
      <div className="min-w-0">
        <p className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">{formatZero(bestBid?.price)}</p>
        <p className="text-slate-500 dark:text-slate-400 text-[11px] truncate">qty {formatZero(bestBid?.quantity)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-red-600 dark:text-red-400 font-semibold truncate">{formatZero(bestAsk?.price)}</p>
        <p className="text-slate-500 dark:text-slate-400 text-[11px] truncate">qty {formatZero(bestAsk?.quantity)}</p>
      </div>
      <span className="text-slate-600 dark:text-slate-300">{formatZero(buyQty)}</span>
      <span className="text-slate-600 dark:text-slate-300">{formatZero(sellQty)}</span>
      <div className="min-w-0">
        <p className="text-emerald-600 dark:text-emerald-400 text-[11px] truncate">{formatNumber(upperCircuit)}</p>
        <p className="text-red-600 dark:text-red-400 text-[11px] truncate">{formatNumber(lowerCircuit)}</p>
      </div>
      <span className="text-slate-500 dark:text-slate-400 text-[11px]">{formatTime(updatedAt)}</span>
      <span>
        {isLive ? (
          <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">Live</span>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">{formatDate(company.last_candle_at)}</span>
        )}
      </span>
    </div>
  );
}
