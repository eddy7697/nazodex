import { prisma as defaultPrisma } from "@/lib/prisma";

type P = typeof defaultPrisma;

export async function listWatchlist(userId: string, p: P = defaultPrisma) {
  const rows = await p.watchlistItem.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r: any) => ({ stockSymbol: r.stockSymbol, sortOrder: r.sortOrder }));
}

export async function addToWatchlist(userId: string, symbol: string, p: P = defaultPrisma) {
  const existing = await p.watchlistItem.findMany({ where: { userId } });
  const nextOrder = existing.reduce((max: number, r: any) => Math.max(max, r.sortOrder), -1) + 1;
  await p.watchlistItem.upsert({
    where: { userId_stockSymbol: { userId, stockSymbol: symbol } },
    create: { id: `${userId}:${symbol}`, userId, stockSymbol: symbol, sortOrder: nextOrder },
    update: {},
  });
}

export async function removeFromWatchlist(userId: string, symbol: string, p: P = defaultPrisma) {
  await p.watchlistItem.deleteMany({ where: { userId, stockSymbol: symbol } });
}

export async function reorderWatchlist(userId: string, symbolsInOrder: string[], p: P = defaultPrisma) {
  const current = await p.watchlistItem.findMany({ where: { userId } });
  const idBySymbol = new Map(current.map((r: any) => [r.stockSymbol, r.id]));
  const ops = symbolsInOrder
    .map((symbol, index) => {
      const id = idBySymbol.get(symbol);
      if (!id) return null;
      return p.watchlistItem.update({ where: { id }, data: { sortOrder: index } });
    })
    .filter(Boolean);
  await p.$transaction(ops as any);
}
