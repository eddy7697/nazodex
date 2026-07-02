"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

export default function QuoteRow({ quote, onRemove }: { quote: Quote; onRemove: (s: string) => void }) {
  const c = changeColorClass(quote.change);
  return (
    <tr className="border-b border-white/5">
      <td className="py-2"><Link href={`/stock/${quote.symbol}`}>{quote.name}<span className="ml-2 text-xs text-gray-400">{quote.symbol}</span></Link></td>
      <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(quote.price)}</td>
      <td className={`py-2 text-right ${c}`}>{fmtSignedPct(quote.changePct)}</td>
      <td className="py-2 text-right text-gray-400">{quote.volume.toLocaleString()}</td>
      <td className="py-2 text-right"><button onClick={() => onRemove(quote.symbol)} className="text-gray-500" aria-label="移除">✕</button></td>
    </tr>
  );
}
