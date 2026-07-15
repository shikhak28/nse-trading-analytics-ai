export const TIMEFRAMES = [
  { key: "1M", label: "1M", months: 1 },
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "1Y", label: "1Y", months: 12 },
  { key: "3Y", label: "3Y", months: 36 },
];

export function timeframeToRange(key) {
  const tf = TIMEFRAMES.find((t) => t.key === key) || TIMEFRAMES[3];
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - tf.months);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
