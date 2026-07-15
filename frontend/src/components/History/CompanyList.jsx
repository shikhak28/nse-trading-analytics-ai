const FILTERS = [
  { value: "all", label: "All Companies" },
  { value: "gainers", label: "Top Gainers" },
  { value: "losers", label: "Top Losers" },
  { value: "volume", label: "Top Volume" },
  { value: "top_bid", label: "Top Bid" },
  { value: "top_sell", label: "Top Sell" },
];

const formatChange = (open, close) => {
  if (!open || !close) return null;
  return ((close - open) / open) * 100;
};

const CompanyList = ({ companies, selectedSymbol, onSelect, search, onSearchChange, filter, onFilterChange, loading, error }) => {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="space-y-2 p-4 border-b border-slate-200 dark:border-slate-800">
        <select
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={filter !== "all"}
          placeholder="Search companies..."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-sm text-slate-500 dark:text-slate-400">
            <div className="mr-3 h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            Loading companies...
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : companies.length === 0 ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">No companies found.</div>
        ) : (
          companies.map((company) => {
            // Movers rows (see marketApi.fetchMovers) already carry a live
            // change_percent/ltp -- fall back to the day-candle-derived
            // change for the plain "All Companies" listing.
            const change = company.change_percent ?? formatChange(company.last_open, company.last_close);
            const price = company.ltp ?? company.last_close;
            const isSelected = company.symbol === selectedSymbol;
            return (
              <button
                key={company.symbol}
                onClick={() => onSelect(company.symbol)}
                className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/70 px-4 py-3 text-left transition ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-950/40"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{company.symbol}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{company.company_name || "—"}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{company.exchange || "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {price != null ? Number(price).toFixed(2) : "—"}
                  </p>
                  {change != null && (
                    <p className={`text-xs font-medium ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {change >= 0 ? "+" : ""}
                      {Number(change).toFixed(2)}%
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CompanyList;
