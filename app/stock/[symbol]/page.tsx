import AppShell from "@/components/layout/AppShell";
import PriceChart from "@/components/stock/PriceChart";
import FundamentalsSection from "@/components/stock/FundamentalsSection";
import { getQuotes } from "@/lib/quotes/quoteService";
import { getFundamentals } from "@/lib/fundamentals/service";
import type { RevenuePoint, EpsPoint } from "@/lib/fundamentals/service";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [quote] = await getQuotes([symbol]);
  let fundamentals: { revenues: RevenuePoint[]; eps: EpsPoint[] } | null = null;
  try {
    fundamentals = await getFundamentals(symbol);
  } catch {
    fundamentals = null; // DB 失敗 → 區塊不渲染,頁面其餘照常
  }
  return (
    <AppShell title={quote ? `${quote.name} ${symbol}` : symbol}>
      {quote && (
        <div className="mb-4">
          <span className="text-3xl font-bold">{quote.price.toFixed(2)}</span>
        </div>
      )}
      <PriceChart symbol={symbol} />
      {fundamentals && <FundamentalsSection revenues={fundamentals.revenues} eps={fundamentals.eps} />}
    </AppShell>
  );
}
