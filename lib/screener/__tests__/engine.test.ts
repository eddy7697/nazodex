import { describe, it, expect } from "vitest";
import { applyConditions, sortRows, PRESETS, CONDITION_DEFS } from "@/lib/screener/engine";
import type { ScreenerRow } from "@/lib/screener/types";

function row(partial: Partial<ScreenerRow>): ScreenerRow {
  return {
    symbol: "0000", name: "測試", close: 100, changePct: 0, volumeLots: 1000,
    peRatio: 15, dividendYield: 4, pbRatio: 1.5, ...partial,
  };
}

describe("applyConditions", () => {
  const rows = [
    row({ symbol: "1101", dividendYield: 6, peRatio: 10 }),
    row({ symbol: "2330", dividendYield: 1.5, peRatio: 25 }),
    row({ symbol: "0050", dividendYield: null, peRatio: null }), // ETF 無估值
  ];
  it("gte/lte AND 串接", () => {
    const out = applyConditions(rows, [
      { field: "dividendYield", op: "gte", value: 5 },
      { field: "peRatio", op: "lte", value: 20 },
    ]);
    expect(out.map((r) => r.symbol)).toEqual(["1101"]);
  });
  it("欄位 null 的列不符合該條件", () => {
    const out = applyConditions(rows, [{ field: "peRatio", op: "lte", value: 30 }]);
    expect(out.map((r) => r.symbol)).toEqual(["1101", "2330"]);
  });
  it("無條件回傳全部", () => {
    expect(applyConditions(rows, [])).toHaveLength(3);
  });
});

describe("sortRows", () => {
  const rows = [
    row({ symbol: "A", dividendYield: 3 }),
    row({ symbol: "B", dividendYield: null }),
    row({ symbol: "C", dividendYield: 7 }),
  ];
  it("desc 且 null 排最後,不改動原陣列", () => {
    const out = sortRows(rows, "dividendYield", "desc");
    expect(out.map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });
  it("asc 且 null 仍排最後", () => {
    const out = sortRows(rows, "dividendYield", "asc");
    expect(out.map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });
});

describe("PRESETS / CONDITION_DEFS", () => {
  it("三個 preset,條件欄位皆在 CONDITION_DEFS 內且方向一致", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(["dividend", "value", "momentum"]);
    for (const p of PRESETS) {
      for (const c of p.conditions) {
        const def = CONDITION_DEFS.find((d) => d.field === c.field);
        expect(def, `${p.key}:${c.field}`).toBeDefined();
        expect(def!.op).toBe(c.op);
      }
    }
  });
});
