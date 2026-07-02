import { describe, it, expect } from "vitest";
import { getDailyQuotesFromDb } from "@/lib/quotes/dbSource";

function mockPrisma(rows: any) {
  return {
    stock: { findMany: async () => [{ symbol: "2330", name: "台積電" }] },
    dailyQuote: {
      findMany: async ({ where }: any) =>
        rows.filter((r: any) => r.stockSymbol === where.stockSymbol),
    },
  } as any;
}

describe("getDailyQuotesFromDb", () => {
  it("以最近兩筆收盤價算出漲跌與漲跌幅", async () => {
    const rows = [
      { stockSymbol: "2330", date: new Date("2026-07-01"), close: 1085, volume: 21000n },
      { stockSymbol: "2330", date: new Date("2026-06-30"), close: 1070, volume: 18000n },
    ];
    const quotes = await getDailyQuotesFromDb(["2330"], mockPrisma(rows));
    expect(quotes[0].symbol).toBe("2330");
    expect(quotes[0].price).toBe(1085);
    expect(quotes[0].change).toBe(15);
    expect(quotes[0].changePct).toBeCloseTo(1.4, 1);
  });
});
