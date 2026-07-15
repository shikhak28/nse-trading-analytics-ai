import { useEffect, useState } from "react";
import { marketApi } from "../api/marketApi";

function Market() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadCompanies = async () => {
      setLoading(true);
      try {
        const data = await marketApi.getCompanies();
        if (data.success) {
          setCompanies(data.results);
        } else {
          setError(data.message || "Unable to load companies.");
        }
      } catch (err) {
        setError(err.message || "Unable to load companies.");
      } finally {
        setLoading(false);
      }
    };

    loadCompanies();
  }, []);

  return (
    <div className="p-8 text-slate-900 dark:text-slate-100">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Company Market Data</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Browse company metadata stored in PostgreSQL.</p>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">Loading companies...</div>
      ) : error ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 text-sm">
                <th className="p-4 border-b border-slate-200 dark:border-slate-800">Symbol</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-800">Name</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-800">Exchange</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-800">Instrument Token</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-800">Segment</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.symbol} className="text-sm">
                  <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{company.symbol}</td>
                  <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{company.company_name || "—"}</td>
                  <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{company.exchange || "—"}</td>
                  <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{company.instrument_token || "—"}</td>
                  <td className="p-4 border-b border-slate-100 dark:border-slate-800/70">{company.segment || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Market;
