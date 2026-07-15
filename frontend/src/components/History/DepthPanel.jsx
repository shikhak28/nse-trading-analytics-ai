const LEVELS = [1, 2, 3, 4, 5];

const Level = ({ side, price, qty, orders }) => (
  <tr className="border-b border-slate-100 dark:border-slate-800/70">
    <td className={`px-4 py-2 text-sm font-medium ${side === "buy" ? "text-emerald-500" : "text-red-500"}`}>
      {price != null ? Number(price).toFixed(2) : "—"}
    </td>
    <td className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300">{qty != null ? Number(qty).toLocaleString() : "—"}</td>
    <td className="px-4 py-2 text-sm text-slate-500 dark:text-slate-400">{orders != null ? orders : "—"}</td>
  </tr>
);

const DepthPanel = ({ snapshot, loading, error }) => {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-500 dark:text-slate-400 shadow-sm">
        <div className="mr-3 h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        Loading order book depth...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-6 text-sm text-amber-800 dark:text-amber-300 shadow-sm">
        {error}
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/70 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Order book depth (5 levels)</h3>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          As of {new Date(snapshot.snapshot_timestamp).toLocaleString()}
        </p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-slate-800/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div>
          <table className="min-w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="px-4 py-2">Bid</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Orders</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => (
                <Level
                  key={`buy-${level}`}
                  side="buy"
                  price={snapshot[`buy${level}_price`]}
                  qty={snapshot[`buy${level}_qty`]}
                  orders={snapshot[`buy${level}_orders`]}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <table className="min-w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="px-4 py-2">Ask</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Orders</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => (
                <Level
                  key={`sell-${level}`}
                  side="sell"
                  price={snapshot[`sell${level}_price`]}
                  qty={snapshot[`sell${level}_qty`]}
                  orders={snapshot[`sell${level}_orders`]}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800/70 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        <p>Total buy qty: {snapshot.total_buy_quantity != null ? Number(snapshot.total_buy_quantity).toLocaleString() : "0"}</p>
        <p className="text-right">Total sell qty: {snapshot.total_sell_quantity != null ? Number(snapshot.total_sell_quantity).toLocaleString() : "0"}</p>
      </div>
    </div>
  );
};

export default DepthPanel;
