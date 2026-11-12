// Shares traded, in Indian units: 1.25 Cr, 3.4 L, 12.3K.
export function formatVolume(value) {
  if (value == null) return "—";
  const v = Number(value);
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
