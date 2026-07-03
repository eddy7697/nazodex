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
};

export function buildFactorRows(snap: ScreenerSnapshot, dayAvg: DayAvgRow[], t86: T86Row[]): StrategySnapshot {
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
  return buildFactorRows(snap, dayAvg, t86);
}

// 每日盤後資料,10min 快取(同 screener 模式;內層 screener 快照另有自己的快取)
const cachedSnapshot = memoize(() => fetchStrategySnapshot({}), 600_000);

export async function getStrategySnapshot(deps: StrategyDeps = {}): Promise<StrategySnapshot> {
  if (deps.screener || deps.dayAvg || deps.t86) return fetchStrategySnapshot(deps);
  return cachedSnapshot("snapshot");
}
