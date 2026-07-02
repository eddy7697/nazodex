import { prisma as defaultPrisma } from "@/lib/prisma";
import type { Quote } from "@/lib/quotes/types";

export async function getDailyQuotesFromDb(
  symbols: string[],
  prismaClient: typeof defaultPrisma = defaultPrisma,
): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const stocks = await prismaClient.stock.findMany({
    where: { symbol: { in: symbols } },
  });
  const nameBySymbol = new Map(stocks.map((s: any) => [s.symbol, s.name]));

  const quotes: Quote[] = [];
  for (const symbol of symbols) {
    const rows = await prismaClient.dailyQuote.findMany({
      where: { stockSymbol: symbol },
      orderBy: { date: "desc" },
      take: 2,
    });
    if (rows.length === 0) continue;
    const latest = rows[0];
    const prev = rows[1];
    const price = latest.close;
    const change = prev ? price - prev.close : 0;
    const changePct = prev && prev.close !== 0 ? (change / prev.close) * 100 : 0;
    quotes.push({
      symbol,
      name: nameBySymbol.get(symbol) ?? symbol,
      price,
      change,
      changePct,
      volume: Number(latest.volume),
      asOf: latest.date.toISOString(),
    });
  }
  return quotes;
}
