import { Fragment, useState } from "react";
import { portfolioApi } from "../../api/portfolioApi";

const formatNumber = (value, digits = 2) =>
  value === null || value === undefined ? "-" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const PnlSpan = ({ value }) => (
  <span className={Number(value) >= 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-red-600 dark:text-red-400 font-semibold"}>
    {Number(value) >= 0 ? "+" : ""}
    {formatNumber(value)}
  </span>
);

const CardShell = ({ title, subtitle, children }) => (
  <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1">{title}</h2>
    {subtitle && <p className="text-slate-500 dark:text-slate-400 text-xs mb-3">{subtitle}</p>}
    {children}
  </div>
);

const HoldingsTable = ({ holdings }) => {
  if (holdings.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">No long-term holdings in this account.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
            <th className="py-2 pr-4">Symbol</th>
            <th className="py-2 pr-4">Qty</th>
            <th className="py-2 pr-4">Avg Price</th>
            <th className="py-2 pr-4">LTP</th>
            <th className="py-2 pr-4">P&L</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={`${h.exchange}-${h.tradingsymbol}`} className="border-b border-slate-50 dark:border-slate-800/70 last:border-0">
              <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-100">{h.tradingsymbol}</td>
              <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{h.quantity}</td>
              <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatNumber(h.average_price)}</td>
              <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatNumber(h.last_price)}</td>
              <td className="py-2 pr-4">
                <PnlSpan value={h.pnl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ConvertForm = ({ position, onSubmit, submitting, result }) => {
  const [newProduct, setNewProduct] = useState("CNC");

  return (
    <div className="mt-2 mb-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-3 flex flex-wrap items-center gap-3">
      <label className="text-xs text-slate-500 dark:text-slate-400">
        Convert to
        <select
          value={newProduct}
          onChange={(e) => setNewProduct(e.target.value)}
          className="ml-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-800 dark:text-slate-100"
        >
          <option value="CNC">CNC</option>
          <option value="MIS">MIS</option>
          <option value="NRML">NRML</option>
        </select>
      </label>
      <button
        onClick={() => onSubmit(position, newProduct)}
        disabled={submitting}
        className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
      >
        {submitting ? "Converting..." : "Confirm Convert"}
      </button>
      {result && (
        <span className={result.success ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-red-600 dark:text-red-400"}>
          {result.success ? "Converted." : result.message}
        </span>
      )}
    </div>
  );
};

const PositionsTable = ({ positions }) => {
  const [convertingKey, setConvertingKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState({});

  if (positions.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">No open positions right now.</p>;
  }

  const rowKey = (p) => `${p.exchange}-${p.tradingsymbol}-${p.product}`;

  const handleConvert = async (position, newProduct) => {
    const key = rowKey(position);
    setSubmitting(true);
    try {
      const response = await portfolioApi.convertPosition({
        exchange: position.exchange,
        tradingsymbol: position.tradingsymbol,
        transaction_type: position.quantity >= 0 ? "BUY" : "SELL",
        position_type: "day",
        quantity: Math.abs(position.quantity),
        old_product: position.product,
        new_product: newProduct,
      });
      setResults((prev) => ({ ...prev, [key]: response }));
    } catch (err) {
      setResults((prev) => ({ ...prev, [key]: { success: false, message: err.message } }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
            <th className="py-2 pr-4">Symbol</th>
            <th className="py-2 pr-4">Product</th>
            <th className="py-2 pr-4">Qty</th>
            <th className="py-2 pr-4">Avg Price</th>
            <th className="py-2 pr-4">LTP</th>
            <th className="py-2 pr-4">P&L</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const key = rowKey(p);
            const isConverting = convertingKey === key;
            return (
              <Fragment key={key}>
                <tr className="border-b border-slate-50 dark:border-slate-800/70 last:border-0">
                  <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-100">{p.tradingsymbol}</td>
                  <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{p.product}</td>
                  <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{p.quantity}</td>
                  <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatNumber(p.average_price)}</td>
                  <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatNumber(p.last_price)}</td>
                  <td className="py-2 pr-4">
                    <PnlSpan value={p.pnl} />
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => setConvertingKey(isConverting ? null : key)}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {isConverting ? "Cancel" : "Convert"}
                    </button>
                  </td>
                </tr>
                {isConverting && (
                  <tr>
                    <td colSpan={7}>
                      <ConvertForm position={p} onSubmit={handleConvert} submitting={submitting} result={results[key]} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const AuctionsTable = ({ auctions }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full text-left text-sm">
      <thead>
        <tr className="text-slate-500 dark:text-slate-400 text-xs border-b border-slate-100 dark:border-slate-800">
          <th className="py-2 pr-4">Symbol</th>
          <th className="py-2 pr-4">Qty</th>
          <th className="py-2 pr-4">Avg Price</th>
        </tr>
      </thead>
      <tbody>
        {auctions.map((a) => (
          <tr key={`${a.exchange}-${a.tradingsymbol}`} className="border-b border-slate-50 dark:border-slate-800/70 last:border-0">
            <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-100">{a.tradingsymbol}</td>
            <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{a.quantity}</td>
            <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatNumber(a.average_price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TradingDetails = ({ holdings, positions, auctions, loading, error }) => {
  if (loading) {
    return (
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-sm text-slate-500 dark:text-slate-400">
        Loading trading details...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-6 text-amber-800 dark:text-amber-300 text-sm">
        {error}
      </div>
    );
  }

  const netPositions = positions?.net || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <CardShell title="Holdings" subtitle="Long-term equity holdings with live P&L">
        <HoldingsTable holdings={holdings || []} />
      </CardShell>

      {netPositions.length > 0 && (
        <CardShell title="Positions" subtitle="Open day/overnight positions">
          <PositionsTable positions={netPositions} />
        </CardShell>
      )}

      {auctions && auctions.length > 0 && (
        <CardShell title="Auctions" subtitle="Instruments currently under auction">
          <AuctionsTable auctions={auctions} />
        </CardShell>
      )}
    </div>
  );
};

export default TradingDetails;
