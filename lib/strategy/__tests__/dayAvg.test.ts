import { describe, it, expect } from "vitest";
import { parseDayAvg } from "@/lib/strategy/dayAvg";

describe("parseDayAvg", () => {
  it("解析 Code/ClosingPrice/MonthlyAveragePrice,千分位可解", () => {
    const rows = parseDayAvg([
      { Date: "1150702", Code: "2330", Name: "台積電", ClosingPrice: "1,085.00", MonthlyAveragePrice: "1,060.50" },
    ]);
    expect(rows).toEqual([{ symbol: "2330", close: 1085, monthlyAvg: 1060.5 }]);
  });
  it("缺值 -、空字串、月均 ≤ 0 的列剔除", () => {
    expect(parseDayAvg([
      { Code: "1101", ClosingPrice: "30", MonthlyAveragePrice: "-" },
      { Code: "1102", ClosingPrice: "", MonthlyAveragePrice: "40" },
      { Code: "1103", ClosingPrice: "50", MonthlyAveragePrice: "0" },
      { Code: "", ClosingPrice: "50", MonthlyAveragePrice: "49" },
    ])).toEqual([]);
  });
  it("非陣列輸入回空陣列", () => {
    expect(parseDayAvg({ oops: true })).toEqual([]);
  });
});
