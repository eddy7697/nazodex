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

// 批次取多檔近 days 個交易日收盤(升冪),給自選清單迷你走勢線。
// 不設 take:資料量 = 檔數 × 累積交易日,目前規模(數十檔 × 數月)可整批撈再截斷。
export async function getSparklines(
  symbols: string[],
  days = 30,
  p: P = defaultPrisma,
): Promise<Record<string, number[]>> {
  if (symbols.length === 0) return {};
  const rows = await p.dailyQuote.findMany({
    where: { stockSymbol: { in: symbols } },
    orderBy: { date: "desc" },
    select: { stockSymbol: true, date: true, close: true },
  });
  const bySymbol: Record<string, number[]> = {};
  for (const r of rows as { stockSymbol: string; close: number }[]) {
    const list = (bySymbol[r.stockSymbol] ??= []);
    if (list.length < days) list.push(r.close); // desc:先收到的是最新
  }
  for (const s of Object.keys(bySymbol)) bySymbol[s].reverse(); // 轉升冪
  return bySymbol;
}
