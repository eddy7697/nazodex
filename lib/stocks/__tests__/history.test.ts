import { describe, it, expect } from "vitest";
import { getHistory, getSparklines } from "@/lib/stocks/history";

function mock(rows: any[]) {
  return {
    dailyQuote: {
      findMany: async ({ where, orderBy, take }: any) => {
        let r = rows.filter((x) => x.stockSymbol === where.stockSymbol);
        r = r.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, take);
        return r;
      },
    },
  } as any;
}

describe("getHistory", () => {
  it("回傳時間升冪的 OHLC", async () => {
    const rows = [
      { stockSymbol: "2330", date: new Date("2026-06-30"), open: 1070, high: 1075, low: 1060, close: 1070 },
      { stockSymbol: "2330", date: new Date("2026-07-01"), open: 1080, high: 1090, low: 1075, close: 1085 },
    ];
    const h = await getHistory("2330", 30, mock(rows));
    expect(h[0].time).toBe("2026-06-30");
    expect(h[1].close).toBe(1085);
  });
});

function mockBatch(rows: any[]) {
  return {
    dailyQuote: {
      findMany: async ({ where }: any) => {
        return rows
          .filter((x) => where.stockSymbol.in.includes(x.stockSymbol))
          .sort((a, b) => b.date.getTime() - a.date.getTime());
      },
    },
  } as any;
}

describe("getSparklines", () => {
  const rows = [
    { stockSymbol: "2330", date: new Date("2026-06-30"), close: 1070 },
    { stockSymbol: "2330", date: new Date("2026-07-01"), close: 1085 },
    { stockSymbol: "2330", date: new Date("2026-07-02"), close: 1090 },
    { stockSymbol: "0050", date: new Date("2026-07-02"), close: 205 },
  ];

  it("依 symbol 分組、收盤日期升冪", async () => {
    const s = await getSparklines(["2330", "0050"], 30, mockBatch(rows));
    expect(s["2330"]).toEqual([1070, 1085, 1090]);
    expect(s["0050"]).toEqual([205]);
  });

  it("每檔最多取最近 days 筆", async () => {
    const s = await getSparklines(["2330"], 2, mockBatch(rows));
    expect(s["2330"]).toEqual([1085, 1090]);
  });

  it("無資料的 symbol 不出現;空清單回空物件", async () => {
    const s = await getSparklines(["9999"], 30, mockBatch(rows));
    expect(s["9999"]).toBeUndefined();
    expect(await getSparklines([], 30, mockBatch(rows))).toEqual({});
  });
});
