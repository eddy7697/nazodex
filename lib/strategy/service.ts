import { prisma } from "@/lib/prisma";
import { memoize } from "@/lib/quotes/cache";
import { getScreenerSnapshot } from "@/lib/screener/service";
import type { ScreenerSnapshot } from "@/lib/screener/types";
import { fetchDayAvg, type DayAvgRow } from "@/lib/strategy/dayAvg";
import { fetchT86, type T86Row } from "@/lib/strategy/t86";
import type { FactorRow, StrategySnapshot } from "@/lib/strategy/types";

export type StrategyDeps = {
  screener?: () => Promise<ScreenerSnapshot>;
  dayAvg?: () => Promise<DayAvgRow[]>;
  t86?: () => Promise<T86Row[]>;
  revenueYoy?: () => Promise<Map<string, number>>;
};

// 近 100 天內每檔最新一期 yoyPct(月營收下月 10 日後才換檔,70 天會在每月交接期斷檔;asc 順序讓較新月份覆蓋)
export async function fetchLatestRevenueYoy(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 100 * 86_400_000);
  const rows = await prisma.monthlyRevenue.findMany({
    where: { month: { gte: since }, yoyPct: { not: null } },
    orderBy: { month: "asc" },
    select: { stockSymbol: true, yoyPct: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.stockSymbol, r.yoyPct!); // asc 順序,後者(較新月份)覆蓋前者
  return map;
}

export function buildFactorRows(
  snap: ScreenerSnapshot,
  dayAvg: DayAvgRow[],
  t86: T86Row[],
  revenueYoy: Map<string, number>,
): StrategySnapshot {
  const avgBySymbol = new Map(dayAvg.map((d) => [d.symbol, d.monthlyAvg]));
  const netBySymbol = new Map(t86.map((t) => [t.symbol, t.totalNetShares]));
  const rows: FactorRow[] = snap.rows.map((r) => {
    const avg = avgBySymbol.get(r.symbol);
    const net = netBySymbol.get(r.symbol);
    const volShares = r.volumeLots * 1000;
    return {
      ...r,
      biasPct: avg != null ? ((r.close - avg) / avg) * 100 : null, // parser 已保證 avg > 0
      chipsRatio: net != null && volShares > 0 ? (net / volShares) * 100 : null,
      revenueYoyPct: revenueYoy.get(r.symbol) ?? null,
    };
  });
  return { date: snap.date, rows };
}

async function fetchStrategySnapshot(deps: StrategyDeps): Promise<StrategySnapshot> {
  const snap = await (deps.screener ?? getScreenerSnapshot)();
  let dayAvg: DayAvgRow[] = [];
  try {
    dayAvg = await (deps.dayAvg ?? fetchDayAvg)();
  } catch {
    // 月均源失敗 → biasPct 全 null,動能因子退化為當日漲幅
  }
  let t86: T86Row[] = [];
  try {
    t86 = await (deps.t86 ?? fetchT86)();
  } catch {
    // 籌碼源失敗 → chipsRatio 全 null,權重再正規化自然吸收
  }
  let revenueYoy = new Map<string, number>();
  try {
    revenueYoy = await (deps.revenueYoy ?? fetchLatestRevenueYoy)();
  } catch {
    // 成長因子全 null,權重再正規化自然吸收
  }
  return buildFactorRows(snap, dayAvg, t86, revenueYoy);
}

// 每日盤後資料,10min 快取(同 screener 模式;內層 screener 快照另有自己的快取)
const cachedSnapshot = memoize(() => fetchStrategySnapshot({}), 600_000);

export async function getStrategySnapshot(deps: StrategyDeps = {}): Promise<StrategySnapshot> {
  if (deps.screener || deps.dayAvg || deps.t86 || deps.revenueYoy) return fetchStrategySnapshot(deps);
  return cachedSnapshot("snapshot");
}
