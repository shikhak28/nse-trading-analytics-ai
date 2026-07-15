const Stat = ({ label, value }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{value ?? "—"}</p>
  </div>
);

const CompanyDetails = ({ company, periodStats }) => {
  if (!company) return null;

  const change =
    periodStats && periodStats.open
      ? ((periodStats.close - periodStats.open) / periodStats.open) * 100
      : null;

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{company.company_name || company.symbol}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {company.symbol} · {company.exchange || "—"} {company.segment ? `· ${company.segment}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            {periodStats?.close != null ? Number(periodStats.close).toFixed(2) : "—"}
          </p>
          {change != null && (
            <p className={`text-sm font-medium ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}% over period
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
        <Stat label="Open" value={periodStats?.open != null ? Number(periodStats.open).toFixed(2) : null} />
        <Stat label="High" value={periodStats?.high != null ? Number(periodStats.high).toFixed(2) : null} />
        <Stat label="Low" value={periodStats?.low != null ? Number(periodStats.low).toFixed(2) : null} />
        <Stat label="Close" value={periodStats?.close != null ? Number(periodStats.close).toFixed(2) : null} />
        <Stat label="Volume" value={periodStats?.volume != null ? Number(periodStats.volume).toLocaleString() : null} />
        <Stat
          label="Last Updated"
          value={periodStats?.lastUpdated ? new Date(periodStats.lastUpdated).toLocaleDateString() : null}
        />
      </div>
    </div>
  );
};

export default CompanyDetails;
