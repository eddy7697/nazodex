import { prisma } from "@/lib/prisma";

export type RevenuePoint = { month: string; revenueBillions: number; yoyPct: number | null; barPct: number };
export type EpsPoint = { label: string; eps: number };

// 千元 → 億元 = /100,000
export function toRevenuePoints(rows: { month: Date; revenue: bigint; yoyPct: number | null }[]): RevenuePoint[] {
  const asc = [...rows].sort((a, b) => a.month.getTime() - b.month.getTime());
  const billions = asc.map((r) => Number(r.revenue) / 100_000);
  const max = Math.max(...billions, 0);
  return asc.map((r, i) => ({
    month: r.month.toISOString().slice(0, 7),
    revenueBillions: billions[i],
    yoyPct: r.yoyPct,
    barPct: max > 0 ? (billions[i] / max) * 100 : 0,
  }));
}

export function toEpsPoints(rows: { quarter: Date; eps: number }[]): EpsPoint[] {
  return [...rows]
    .sort((a, b) => a.quarter.getTime() - b.quarter.getTime())
    .map((r) => ({
      label: `${r.quarter.getUTCFullYear()} Q${Math.floor(r.quarter.getUTCMonth() / 3) + 1}`,
      eps: r.eps,
    }));
}

export async function getFundamentals(symbol: string): Promise<{ revenues: RevenuePoint[]; eps: EpsPoint[] }> {
  const [rev, eps] = await Promise.all([
    prisma.monthlyRevenue.findMany({ where: { stockSymbol: symbol }, orderBy: { month: "desc" }, take: 12 }),
    prisma.quarterlyEps.findMany({ where: { stockSymbol: symbol }, orderBy: { quarter: "desc" }, take: 8 }),
  ]);
  return { revenues: toRevenuePoints(rev), eps: toEpsPoints(eps) };
}
