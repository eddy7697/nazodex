"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import Sparkline from "@/components/watchlist/Sparkline";

export default function QuoteCard({
  quote, onRemove, dragHandle, cardRef, style, closes,
}: {
  quote: Quote;
  onRemove: (s: string) => void;
  dragHandle?: React.ReactNode;
  cardRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  closes?: number[];
}) {
  const c = changeColorClass(quote.change);
  return (
    <div ref={cardRef} style={style} className="flex items-center justify-between rounded-lg bg-[var(--card)] p-4">
      {dragHandle}
      <Link href={`/stock/${quote.symbol}`} className="flex-1">
        <div className="font-bold">{quote.name}</div>
        <div className="text-xs text-gray-400">{quote.symbol}</div>
      </Link>
      <Sparkline closes={closes} />
      <div className="ml-3 text-right">
        <div className={`text-xl font-bold ${c}`}>{fmtPrice(quote.price)}</div>
        <div className="text-sm">
          <span className={c}>{quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : ""}</span>{" "}
          <span className={c}>{fmtSignedPct(quote.changePct)}</span>
        </div>
      </div>
      <button onClick={() => onRemove(quote.symbol)} className="ml-3 text-gray-500" aria-label="移除">✕</button>
    </div>
  );
}
