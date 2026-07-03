import { describe, it, expect } from "vitest";
import { buildReasons, compositeScore, computeFactorScores, inUniverse, percentileRanks, recommend, STRATEGIES } from "@/lib/strategy/engine";
import type { FactorRow, FactorScores, Weights } from "@/lib/strategy/types";

export function makeRow(over: Partial<FactorRow>): FactorRow {
  return {
    symbol: "0000", name: "測試", close: 100, changePct: 0, volumeLots: 1000,
    peRatio: 15, dividendYield: 4, pbRatio: 1.5, biasPct: 0, chipsRatio: 0,
    ...over,
  };
}

describe("percentileRanks", () => {
  it("嚴格小於計數 / (n-1) × 100;null 保持 null 且不入母體", () => {
    expect(percentileRanks([10, 20, null, 30])).toEqual([0, 50, null, 100]);
  });
  it("同值同名次(ties 取相同百分位)", () => {
    const [a, b, c] = percentileRanks([5, 5, 9]);
    expect(a).toBe(b);
    expect(c).toBe(100);
  });
  it("母體 < 2 → 50", () => {
    expect(percentileRanks([7, null])).toEqual([50, null]);
  });
});

describe("inUniverse", () => {
  it("成交 ≥ 200 張且股價 ≥ 5 元", () => {
    expect(inUniverse(makeRow({ volumeLots: 200, close: 5 }))).toBe(true);
    expect(inUniverse(makeRow({ volumeLots: 199 }))).toBe(false);
    expect(inUniverse(makeRow({ close: 4.9 }))).toBe(false);
  });
});

describe("computeFactorScores", () => {
  it("價值取 PE/PB 低者佳均值;收息/籌碼/熱度高者佳;動能為乖離+漲幅均值", () => {
    const rows = [
      makeRow({ peRatio: 10, pbRatio: 1, dividendYield: 6, biasPct: 5, changePct: 3, chipsRatio: 2, volumeLots: 5000 }),
      makeRow({ peRatio: 30, pbRatio: 3, dividendYield: 1, biasPct: -5, changePct: -3, chipsRatio: -2, volumeLots: 300 }),
    ];
    const [good, bad] = computeFactorScores(rows);
    expect(good.value).toBe(100);   // PE、PB 皆最低 → 低者佳 100
    expect(bad.value).toBe(0);
    expect(good.dividend).toBe(100);
    expect(good.momentum).toBe(100);
    expect(good.chips).toBe(100);
    expect(good.heat).toBe(100);
    expect(bad.heat).toBe(0);
  });
  it("因子輸入 null → 該因子 null;單邊 null 的複合因子取另一邊", () => {
    const rows = [
      makeRow({ peRatio: null, pbRatio: null, dividendYield: null, biasPct: null, changePct: 2 }),
      makeRow({ peRatio: 10, pbRatio: 1, dividendYield: 3, biasPct: 1, changePct: 1 }),
    ];
    const [etf] = computeFactorScores(rows);
    expect(etf.value).toBeNull();
    expect(etf.dividend).toBeNull();
    expect(etf.momentum).toBe(100); // 只剩 changePct,2 > 1
  });
});

const W: Weights = { value: 0.2, dividend: 0.2, momentum: 0.2, chips: 0.2, heat: 0.2 };

describe("compositeScore", () => {
  it("加權平均", () => {
    const f: FactorScores = { value: 100, dividend: 50, momentum: 0, chips: 50, heat: 50 };
    expect(compositeScore(f, W)).toBe(50);
  });
  it("缺因子 → 權重再正規化(不拖分)", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: 80, chips: 80, heat: 80 };
    expect(compositeScore(f, W)).toBe(80);
  });
  it("非 null 因子 < 3 → null(不進榜)", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: null, chips: 90, heat: 90 };
    expect(compositeScore(f, W)).toBeNull();
  });
});

describe("STRATEGIES", () => {
  it("5 檔策略,權重和皆為 1", () => {
    expect(STRATEGIES).toHaveLength(5);
    expect(STRATEGIES.map((s) => s.key)).toEqual(["balanced", "income", "value", "momentum", "chips"]);
    for (const s of STRATEGIES) {
      const sum = Object.values(s.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });
});

describe("buildReasons", () => {
  it("取分數最高兩因子,>=90 用「前 X%」、其餘用「贏過 X%」", () => {
    const f: FactorScores = { value: 20, dividend: 95, momentum: 60, chips: 30, heat: 10 };
    const reasons = buildReasons(f, makeRow({ biasPct: null }));
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toBe("殖利率前 5%");
    expect(reasons[1]).toBe("價格動能贏過 60% 的股票");
  });
  it("動能站上月均線時帶乖離數字", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: 92, chips: 10, heat: 20 };
    const reasons = buildReasons(f, makeRow({ biasPct: 4.2 }));
    expect(reasons[0]).toBe("站上月均線 +4.2%,動能前 8%");
  });
});

describe("recommend", () => {
  it("過濾 universe、依綜合分數排序取 topN,同分以張數 tie-break", () => {
    const rows = [
      makeRow({ symbol: "GOOD", peRatio: 8, pbRatio: 0.8, dividendYield: 7, biasPct: 6, changePct: 4, chipsRatio: 3, volumeLots: 9000 }),
      makeRow({ symbol: "MID", peRatio: 15, pbRatio: 1.5, dividendYield: 4, biasPct: 0, changePct: 0, chipsRatio: 0, volumeLots: 800 }),
      makeRow({ symbol: "BAD", peRatio: 40, pbRatio: 4, dividendYield: 0.5, biasPct: -8, changePct: -4, chipsRatio: -3, volumeLots: 600 }),
      makeRow({ symbol: "TINY", volumeLots: 50 }), // 不在 universe
    ];
    const recs = recommend(rows, W, 2);
    expect(recs.map((r) => r.row.symbol)).toEqual(["GOOD", "MID"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
    expect(recs[0].reasons.length).toBe(2);
    expect(recs.some((r) => r.row.symbol === "TINY")).toBe(false);
  });
});
