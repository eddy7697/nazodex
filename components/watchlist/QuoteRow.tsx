"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import Sparkline from "@/components/watchlist/Sparkline";

export default function QuoteRow({
  quote, onRemove, dragHandle, rowRef, style, closes,
}: {
  quote: Quote;
  onRemove: (s: string) => void;
  dragHandle?: React.ReactNode;
  rowRef?: React.Ref<HTMLTableRowElement>;
  style?: React.CSSProperties;
  closes?: number[];
}) {
  const c = changeColorClass(quote.change);
  return (
    <tr ref={rowRef} style={style} className="border-b border-white/5 bg-[var(--bg)]">
      <td className="py-2">
        <span className="flex items-center">
          {dragHandle}
          <Link href={`/stock/${quote.symbol}`}>{quote.name}<span className="ml-2 text-xs text-gray-400">{quote.symbol}</span></Link>
        </span>
      </td>
      <td className="py-2"><Sparkline closes={closes} width={80} /></td>
      <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(quote.price)}</td>
      <td className={`py-2 text-right ${c}`}>{fmtSignedPct(quote.changePct)}</td>
      <td className="py-2 text-right text-gray-400">{quote.volume.toLocaleString()}</td>
      <td className="py-2 text-right"><button onClick={() => onRemove(quote.symbol)} className="text-gray-500" aria-label="移除">✕</button></td>
    </tr>
  );
}
