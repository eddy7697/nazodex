import { describe, it, expect, vi } from "vitest";
import { getMarketOverview } from "@/lib/market-overview/service";
import type { Breadth, InstitutionalFlow, SectorSummary } from "@/lib/market-overview/types";
import type { Quote } from "@/lib/quotes/types";

const idx: Quote = { symbol: "t00", name: "加權指數", price: 1, change: 0, changePct: 0, volume: 0, asOf: "x" };
const breadth: Breadth = { date: "2026-07-02", up: 1, limitUp: 0, down: 2, limitDown: 0, unchanged: 3 };
const inst: InstitutionalFlow = { date: "2026-07-02", foreign: -1, trust: 2, dealer: 3, total: 4 };
const sectors: SectorSummary = { date: "2026-07-02", sectors: [{ name: "機電", close: 1, changePct: 0.5 }] };

describe("getMarketOverview", () => {
  it("組裝四個區塊", async () => {
    const out = await getMarketOverview({
      indices: async () => [idx],
      breadth: async () => breadth,
      institutional: async () => inst,
      sectors: async () => sectors,
    });
    expect(out).toEqual({ indices: [idx], breadth, institutional: inst, sectors });
  });
  it("單一區塊失敗時該區塊為 null/空,其他不受影響", async () => {
    const out = await getMarketOverview({
      indices: async () => { throw new Error("mis down"); },
      breadth: async () => { throw new Error("twse down"); },
      institutional: async () => inst,
      sectors: async () => sectors,
    });
    expect(out.indices).toEqual([]);
    expect(out.breadth).toBeNull();
    expect(out.institutional).toEqual(inst);
    expect(out.sectors).toEqual(sectors);
  });
});

import { getIndices } from "@/lib/market-overview/service";

describe("getIndices", () => {
  const q = (symbol: string): any => ({ symbol, name: symbol, price: 1, change: 0, changePct: 0, volume: 0, asOf: "x" });

  it("回傳注入的指數", async () => {
    const indices = await getIndices({ indices: async () => [q("t00"), q("o00")] });
    expect(indices.map((i: any) => i.symbol)).toEqual(["t00", "o00"]);
  });

  it("上游失敗回空陣列", async () => {
    const indices = await getIndices({ indices: async () => { throw new Error("boom"); } });
    expect(indices).toEqual([]);
  });
});
