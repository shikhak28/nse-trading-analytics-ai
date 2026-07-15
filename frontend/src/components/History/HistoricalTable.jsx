import { useMemo, useState } from "react";

const COLUMNS = [
  { key: "date", label: "Date" },
  { key: "open", label: "Open" },
  { key: "high", label: "High" },
  { key: "low", label: "Low" },
  { key: "close", label: "Close" },
  { key: "volume", label: "Volume" },
];

const HistoricalTable = ({ candles }) => {
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const copy = [...candles];
    copy.sort((a, b) => {
      const aVal = sortKey === "date" ? new Date(a[sortKey]).getTime() : Number(a[sortKey]);
      const bVal = sortKey === "date" ? new Date(b[sortKey]).getTime() : Number(b[sortKey]);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [candles, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (!candles || candles.length === 0) return null;

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="max-h-96 overflow-y-auto overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-white dark:bg-slate-900">
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer select-none px-4 py-3 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr key={index} className="border-b border-slate-100 dark:border-slate-800/70 text-slate-700 dark:text-slate-300">
                <td className="px-4 py-2.5">{new Date(row.date).toLocaleDateString()}</td>
                <td className="px-4 py-2.5">{Number(row.open).toFixed(2)}</td>
                <td className="px-4 py-2.5">{Number(row.high).toFixed(2)}</td>
                <td className="px-4 py-2.5">{Number(row.low).toFixed(2)}</td>
                <td className="px-4 py-2.5">{Number(row.close).toFixed(2)}</td>
                <td className="px-4 py-2.5">{Number(row.volume).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HistoricalTable;
