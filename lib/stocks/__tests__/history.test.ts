import { describe, it, expect } from "vitest";
import { getHistory } from "@/lib/stocks/history";

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
