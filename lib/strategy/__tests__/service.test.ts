import { describe, it, expect } from "vitest";
import { buildFactorRows, getStrategySnapshot } from "@/lib/strategy/service";
import type { ScreenerSnapshot } from "@/lib/screener/types";

const snap: ScreenerSnapshot = {
  date: "2026-07-02",
  rows: [
    { symbol: "2330", name: "台積電", close: 1085, changePct: 0.46, volumeLots: 21000, peRatio: 25.5, dividendYield: 1.55, pbRatio: 7.5 },
    { symbol: "1101", name: "台泥", close: 30, changePct: null, volumeLots: 0, peRatio: null, dividendYield: null, pbRatio: null },
  ],
};

describe("buildFactorRows", () => {
  it("join 月均與 T86,算 biasPct 與 chipsRatio(佔成交量%)", () => {
    const out = buildFactorRows(snap,
      [{ symbol: "2330", close: 1085, monthlyAvg: 1000 }],
      [{ symbol: "2330", totalNetShares: 2_100_000 }]);
    const tsmc = out.rows.find((r) => r.symbol === "2330")!;
    expect(tsmc.biasPct).toBeCloseTo(8.5, 5);        // (1085-1000)/1000×100
    expect(tsmc.chipsRatio).toBeCloseTo(10, 5);      // 2,100,000 / 21,000,000 股 ×100
    expect(out.date).toBe("2026-07-02");
  });
  it("無對應月均/法人、或成交量 0 → null(除零保護)", () => {
    const out = buildFactorRows(snap, [], [{ symbol: "1101", totalNetShares: 5000 }]);
    const cement = out.rows.find((r) => r.symbol === "1101")!;
    expect(cement.biasPct).toBeNull();
    expect(cement.chipsRatio).toBeNull(); // volumeLots 0
  });
});

describe("getStrategySnapshot", () => {
  it("月均/T86 源失敗 → 對應欄全 null 仍回快照(區塊容錯)", async () => {
    const out = await getStrategySnapshot({
      screener: async () => snap,
      dayAvg: async () => { throw new Error("avg down"); },
      t86: async () => { throw new Error("t86 down"); },
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.biasPct === null && r.chipsRatio === null)).toBe(true);
  });
  it("價量(screener)源失敗 → throw", async () => {
    await expect(
      getStrategySnapshot({ screener: async () => { throw new Error("down"); }, dayAvg: async () => [], t86: async () => [] }),
    ).rejects.toThrow("down");
  });
});
