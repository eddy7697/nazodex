import { describe, it, expect } from "vitest";
import { parseMonthRevenue, parseQuarterlyEps } from "@/lib/ingest/twseFundamentals";

const revenueSample = [
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "2330", 公司名稱: "台積電",
    "營業收入-當月營收": "416975163", "營業收入-去年同月增減(%)": "30.09498020271696" },
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "6547", 公司名稱: "高端疫苗",
    "營業收入-當月營收": "12345", "營業收入-去年同月增減(%)": "" }, // 上市首年無 YoY → null
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "6024", 公司名稱: "群益期",
    "營業收入-當月營收": "-244632", "營業收入-去年同月增減(%)": "-15.5" }, // 期貨負營收
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "9999", 公司名稱: "壞資料",
    "營業收入-當月營收": "" }, // 無營收 → 略過
];

describe("parseMonthRevenue", () => {
  it("民國年月轉 ISO 月初、營收 bigint(千元)、官方 YoY;缺 YoY 為 null、缺營收列略過", () => {
    const rows = parseMonthRevenue(revenueSample);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ symbol: "2330", month: "2026-05-01", revenue: 416975163n, yoyPct: 30.09498020271696 });
    expect(rows[1].yoyPct).toBeNull();
    expect(rows[2]).toEqual({ symbol: "6024", month: "2026-05-01", revenue: -244632n, yoyPct: -15.5 });
  });
  it("負營收(期貨)納入", () => {
    const rows = parseMonthRevenue([
      { 出表日期: "1150617", 資料年月: "11505", 公司代號: "6024", 公司名稱: "群益期",
        "營業收入-當月營收": "-244632", "營業收入-去年同月增減(%)": "-15.5" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ symbol: "6024", month: "2026-05-01", revenue: -244632n, yoyPct: -15.5 });
  });
  it("非陣列輸入回 []", () => {
    expect(parseMonthRevenue(null)).toEqual([]);
  });
});

const epsSample = [
  { 出表日期: "1150708", 年度: "115", 季別: "1", 公司代號: "2330", "基本每股盈餘(元)": "22.08" },
  { 出表日期: "1150708", 年度: "115", 季別: "3", 公司代號: "1101", "基本每股盈餘(元)": "-0.05" }, // 虧損負值保留
  { 出表日期: "1150708", 年度: "115", 季別: "2", 公司代號: "9998", "基本每股盈餘(元)": "" }, // 缺值 → 略過
  { 出表日期: "1150708", 年度: "115", 季別: "5", 公司代號: "9997", "基本每股盈餘(元)": "1.0" }, // 季別非 1-4 → 略過
];

describe("parseQuarterlyEps", () => {
  it("年度/季別轉季首日 ISO;負 EPS 保留;缺值與非法季別略過", () => {
    const rows = parseQuarterlyEps(epsSample);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ symbol: "2330", quarter: "2026-01-01", eps: 22.08 });
    expect(rows[1]).toEqual({ symbol: "1101", quarter: "2026-07-01", eps: -0.05 });
  });
});
