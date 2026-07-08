import { describe, it, expect, vi } from "vitest";
import { parseStockPrice, parseStockInfo, getStockPrice, getStockInfo } from "@/lib/finmind/datasets";
import type { FinMindClient } from "@/lib/finmind/client";

const priceRaw = [
  { date: "2026-07-01", stock_id: "2330", Trading_Volume: 37544470, Trading_money: 93600076825, open: 2495.0, max: 2505.0, min: 2475.0, close: 2505.0, spread: 95.0, Trading_turnover: 111091 },
  { date: "2026-07-02", stock_id: "2330", Trading_Volume: 0, open: 0, max: 0, min: 0, close: 0 }, // 停牌日:close 0 → 略過
];

describe("parseStockPrice", () => {
  it("欄位對映 max→high/min→low/Trading_Volume→volume,略過 close ≤ 0 的列", () => {
    const rows = parseStockPrice(priceRaw);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: "2026-07-01", open: 2495, high: 2505, low: 2475, close: 2505, volume: 37544470 });
  });
});

const infoRaw = [
  { industry_category: "半導體業", stock_id: "2330", stock_name: "台積電", type: "twse", date: "2020-06-03" },
  { industry_category: "電子工業", stock_id: "2330", stock_name: "台積電", type: "twse", date: "2020-06-03" }, // 重複列:一股多產業
  { industry_category: "光電業", stock_id: "3629", stock_name: "地心引力", type: "tpex", date: "2020-06-03" },
  { industry_category: "ETF", stock_id: "0050", stock_name: "元大台灣50", type: "twse", date: "2020-06-03" },
  { industry_category: "ETF", stock_id: "00878", stock_name: "國泰永續高股息", type: "twse", date: "2020-06-03" },
  { industry_category: "債券 ETF", stock_id: "00679B", stock_name: "元大美債20年", type: "twse", date: "2020-06-03" }, // 債券 ETF 尾碼字母 → 應納入
  { industry_category: "ETF", stock_id: "00632R", stock_name: "槓反", type: "twse", date: "2020-06-03" }, // 槓反 ETF 尾碼字母 → 應納入
  { industry_category: "金融保險業", stock_id: "2881B", stock_name: "富邦特別股", type: "twse", date: "2020-06-03" }, // 特別股尾碼字母 → 應納入
  { industry_category: "大盤", stock_id: "TAIEX", stock_name: "加權指數", type: "twse", date: "2020-06-03" }, // 非個股 → 排除
  { industry_category: "認購權證", stock_id: "030001", stock_name: "某權證", type: "twse", date: "2020-06-03" }, // 6碼非00開頭 → 排除
  { industry_category: "認購權證", stock_id: "030002", stock_name: "某權證", type: "twse", date: "2020-06-03" }, // 6碼權證 → 排除
  { industry_category: "", stock_id: "8069", stock_name: "元太", type: "tpex", date: "2020-06-03" }, // 空產業 → industry null
];

describe("parseStockInfo", () => {
  it("過濾:4碼數字或00開頭含尾碼字母(債券/槓反/特別股);twse→TSE/tpex→OTC;依 stock_id 去重取第一列;空產業→null;權證排除", () => {
    const rows = parseStockInfo(infoRaw);
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    expect(bySymbol.get("2330")).toEqual({ symbol: "2330", name: "台積電", market: "TSE", industry: "半導體業" });
    expect(bySymbol.get("3629")?.market).toBe("OTC");
    expect(bySymbol.get("0050")?.industry).toBe("ETF");
    expect(bySymbol.has("00878")).toBe(true);
    expect(bySymbol.get("00679B")).toEqual({ symbol: "00679B", name: "元大美債20年", market: "TSE", industry: "債券 ETF" }); // 債券 ETF 尾碼字母納入
    expect(bySymbol.get("00632R")).toEqual({ symbol: "00632R", name: "槓反", market: "TSE", industry: "ETF" }); // 槓反 ETF 尾碼字母納入
    expect(bySymbol.get("2881B")).toEqual({ symbol: "2881B", name: "富邦特別股", market: "TSE", industry: "金融保險業" }); // 特別股尾碼字母納入
    expect(bySymbol.has("TAIEX")).toBe(false);
    expect(bySymbol.has("030001")).toBe(false); // 權證排除
    expect(bySymbol.has("030002")).toBe(false); // 權證排除
    expect(bySymbol.get("8069")?.industry).toBeNull();
    expect(rows.filter((r) => r.symbol === "2330")).toHaveLength(1);
  });
});

describe("dataset wrappers", () => {
  it("getStockPrice 帶正確參數呼叫 client", async () => {
    const fetchDataset = vi.fn(async () => priceRaw);
    const client = { fetchDataset } as unknown as FinMindClient;
    const rows = await getStockPrice(client, "2330", "2021-07-01", "2026-07-08");
    expect(fetchDataset).toHaveBeenCalledWith({ dataset: "TaiwanStockPrice", data_id: "2330", start_date: "2021-07-01", end_date: "2026-07-08" });
    expect(rows).toHaveLength(1);
  });

  it("getStockInfo 不帶 data_id", async () => {
    const fetchDataset = vi.fn(async () => infoRaw);
    const client = { fetchDataset } as unknown as FinMindClient;
    const rows = await getStockInfo(client);
    expect(fetchDataset).toHaveBeenCalledWith({ dataset: "TaiwanStockInfo" });
    expect(rows.length).toBeGreaterThan(0);
  });
});
