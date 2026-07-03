import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

export default function IndexCard({ quote }: { quote: Quote }) {
  const c = changeColorClass(quote.change);
  return (
    <div className="flex-1 rounded-lg bg-[var(--card)] p-4">
      <div className="text-sm text-gray-400">{quote.name}</div>
      <div className={`text-2xl font-bold ${c}`}>{fmtPrice(quote.price)}</div>
      <div className={`text-sm ${c}`}>
        {quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : ""} {fmtPrice(Math.abs(quote.change))}(
        {fmtSignedPct(quote.changePct)})
      </div>
    </div>
  );
}
