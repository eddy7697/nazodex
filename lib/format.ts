export function changeColorClass(change: number): string {
  if (change > 0) return "text-up";
  if (change < 0) return "text-down";
  return "text-gray-400";
}
export function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}
export function fmtSignedPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
// 元 → 億,帶正負號、一位小數(三大法人買賣超用)
export function fmtSignedYi(n: number): string {
  const yi = n / 1e8;
  const sign = yi > 0 ? "+" : "";
  return `${sign}${yi.toFixed(1)}`;
}
export function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
export function fmtSignedMoney(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : ""}${r.toLocaleString("en-US")}`;
}
