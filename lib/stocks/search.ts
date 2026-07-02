import { prisma as defaultPrisma } from "@/lib/prisma";
type P = typeof defaultPrisma;

export async function searchStocks(query: string, p: P = defaultPrisma) {
  const q = query.trim();
  if (!q) return [];
  const rows = await p.stock.findMany({
    where: { OR: [{ symbol: { contains: q } }, { name: { contains: q } }] },
    take: 20,
  });
  return rows.map((r: any) => ({ symbol: r.symbol, name: r.name }));
}
