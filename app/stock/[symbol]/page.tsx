import AppShell from "@/components/layout/AppShell";
import PriceChart from "@/components/stock/PriceChart";
import { getQuotes } from "@/lib/quotes/quoteService";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [quote] = await getQuotes([symbol]);
  return (
    <AppShell title={quote ? `${quote.name} ${symbol}` : symbol}>
      {quote && (
        <div className="mb-4">
          <span className="text-3xl font-bold">{quote.price.toFixed(2)}</span>
        </div>
      )}
      <PriceChart symbol={symbol} />
    </AppShell>
  );
}
