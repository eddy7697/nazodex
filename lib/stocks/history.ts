import { prisma as defaultPrisma } from "@/lib/prisma";
type P = typeof defaultPrisma;

export async function getHistory(symbol: string, days: number, p: P = defaultPrisma) {
  const rows = await p.dailyQuote.findMany({
    where: { stockSymbol: symbol },
    orderBy: { date: "desc" },
    take: days,
  });
  return rows
    .map((r: any) => ({
      time: r.date.toISOString().slice(0, 10),
      open: r.open, high: r.high, low: r.low, close: r.close,
    }))
    .sort((a: any, b: any) => (a.time < b.time ? -1 : 1));
}
