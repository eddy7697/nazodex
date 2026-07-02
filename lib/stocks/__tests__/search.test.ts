import { describe, it, expect } from "vitest";
import { searchStocks } from "@/lib/stocks/search";

function mock(rows: any[]) {
  return {
    stock: {
      findMany: async ({ where, take }: any) => {
        const q = where.OR[0].symbol?.startsWith ?? where.OR[0].symbol?.contains;
        return rows
          .filter((r) =>
            r.symbol.includes(where.OR[0].symbol.contains) ||
            r.name.includes(where.OR[1].name.contains),
          )
          .slice(0, take);
      },
    },
  } as any;
}

describe("searchStocks", () => {
  const rows = [
    { symbol: "2330", name: "台積電" },
    { symbol: "2454", name: "聯發科" },
  ];
  it("用代號搜尋", async () => {
    const r = await searchStocks("2330", mock(rows));
    expect(r[0].symbol).toBe("2330");
  });
  it("用名稱搜尋", async () => {
    const r = await searchStocks("聯發", mock(rows));
    expect(r[0].symbol).toBe("2454");
  });
  it("空字串回空陣列", async () => {
    expect(await searchStocks("", mock(rows))).toEqual([]);
  });
});
