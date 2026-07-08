import { describe, it, expect } from "vitest";
import { parseTpexDaily } from "@/lib/ingest/tpexOpenApi";

const sample = [
  {
    Date: "1150708", SecuritiesCompanyCode: "5483", CompanyName: "中美晶",
    Close: "168.50", Change: "1.50", Open: "167.00", High: "169.00", Low: "166.50",
    Average: "167.80", TradingShares: "3,251,000", TransactionAmount: "545,618,000", TransactionNumber: "2,100",
  },
  { Date: "1150708", SecuritiesCompanyCode: "707771", CompanyName: "某權證", Close: "0.55", Open: "0.5", High: "0.6", Low: "0.5", TradingShares: "10,000" }, // 權證代號 → 排除
  { Date: "1150708", SecuritiesCompanyCode: "8069", CompanyName: "元太", Close: "---", Open: "---", High: "---", Low: "---", TradingShares: "0" }, // 無成交 → 排除
  { Date: "1150708", SecuritiesCompanyCode: "00679B", CompanyName: "元大美債20年", Close: "30.50", Open: "30.40", High: "30.55", Low: "30.35", TradingShares: "12,000,000" }, // 債券 ETF 尾碼字母 → 應納入
];

describe("parseTpexDaily", () => {
  it("解析上櫃列:代號過濾(4碼/00開頭含尾碼字母)、千分位、民國日期轉 ISO", () => {
    const rows = parseTpexDaily(sample);
    expect(rows).toHaveLength(2);
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    expect(bySymbol.get("5483")).toMatchObject({ name: "中美晶", close: 168.5, open: 167, high: 169, low: 166.5, volume: 3251000, date: "2026-07-08" });
    expect(bySymbol.get("00679B")).toMatchObject({ name: "元大美債20年", close: 30.5, volume: 12000000 });
    expect(bySymbol.has("707771")).toBe(false); // 權證排除
  });
  it("非陣列輸入回 []", () => {
    expect(parseTpexDaily(null)).toEqual([]);
    expect(parseTpexDaily({})).toEqual([]);
  });
});
