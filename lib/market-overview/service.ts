import { memoize } from "@/lib/quotes/cache";
import { getIndexQuotes } from "@/lib/market-overview/indices";
import { fetchBreadth, fetchInstitutional } from "@/lib/market-overview/twseRwd";
import { fetchSectorIndices } from "@/lib/market-overview/sectors";
import type { Breadth, InstitutionalFlow, MarketOverview, SectorSummary } from "@/lib/market-overview/types";
import type { Quote } from "@/lib/quotes/types";

export type OverviewDeps = {
  indices?: () => Promise<Quote[]>;
  breadth?: () => Promise<Breadth | null>;
  institutional?: () => Promise<InstitutionalFlow | null>;
  sectors?: () => Promise<SectorSummary | null>;
};

// 模組層共享快取:指數盤中即時(30s,同報價),每日盤後資料變動一天一次(10min)。
// memoize 的 key 介面吃 string,這裡各 fetcher 無參數,固定用單一 key。
const cachedIndices = memoize(() => getIndexQuotes(), 30_000);
const cachedBreadth = memoize(() => fetchBreadth(), 600_000);
const cachedInstitutional = memoize(() => fetchInstitutional(), 600_000);
const cachedSectors = memoize(() => fetchSectorIndices(), 600_000);

async function orNull<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null; // 單一上游失敗只影響自己的區塊
  }
}

export async function getMarketOverview(deps: OverviewDeps = {}): Promise<MarketOverview> {
  const [indices, breadth, institutional, sectors] = await Promise.all([
    orNull(deps.indices ?? (() => cachedIndices("indices"))),
    orNull(deps.breadth ?? (() => cachedBreadth("breadth"))),
    orNull(deps.institutional ?? (() => cachedInstitutional("institutional"))),
    orNull(deps.sectors ?? (() => cachedSectors("sectors"))),
  ]);
  return { indices: indices ?? [], breadth, institutional, sectors };
}

// 首頁指數列輕量入口:只取指數,與 getMarketOverview 共享 cachedIndices 快取。
export async function getIndices(deps: OverviewDeps = {}): Promise<Quote[]> {
  return (await orNull(deps.indices ?? (() => cachedIndices("indices")))) ?? [];
}
