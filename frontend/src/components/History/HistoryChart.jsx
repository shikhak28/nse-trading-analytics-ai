import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-700 dark:text-slate-200">{formatDate(label)}</p>
      <p className="text-slate-500 dark:text-slate-400">Open: {Number(point.open).toFixed(2)}</p>
      <p className="text-slate-500 dark:text-slate-400">High: {Number(point.high).toFixed(2)}</p>
      <p className="text-slate-500 dark:text-slate-400">Low: {Number(point.low).toFixed(2)}</p>
      <p className="text-slate-500 dark:text-slate-400">Close: {Number(point.close).toFixed(2)}</p>
      <p className="text-slate-500 dark:text-slate-400">Volume: {Number(point.volume).toLocaleString()}</p>
    </div>
  );
};

const HistoryChart = ({ candles }) => {
  if (!candles || candles.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-500 dark:text-slate-400">
        No historical data available for this timeframe.
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <div className="h-72 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={candles} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="closeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={60} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="close"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#closeFill)"
              isAnimationActive
              animationDuration={400}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 h-20 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={candles} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="volume" fill="#94a3b8" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={400} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default HistoryChart;
