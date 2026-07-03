import { describe, it, expect } from "vitest";
import {
  computePositions, validateNoOversell, computeSummary, type Txn,
} from "@/lib/holdings/positions";

let seq = 0;
function txn(partial: Partial<Txn> & Pick<Txn, "side" | "quantity" | "price">): Txn {
  seq += 1;
  return {
    id: `t${seq}`, stockSymbol: "2330", fee: 0, tax: 0,
    date: new Date("2026-01-01"), createdAt: new Date(2026, 0, 1, 9, 0, seq),
    ...partial,
  };
}

describe("computePositions", () => {
  it("單筆買進:成本含手續費", () => {
    const [p] = computePositions([txn({ side: "BUY", quantity: 1000, price: 600, fee: 855 })]);
    expect(p).toEqual({
      symbol: "2330", shares: 1000, totalCost: 600855,
      avgCost: 600.855, realizedPnl: 0, dividendIncome: 0,
    });
  });
  it("兩筆買進攤平均價", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 600 }),
      txn({ side: "BUY", quantity: 1000, price: 500 }),
    ]);
    expect(p.shares).toBe(2000);
    expect(p.avgCost).toBe(550);
  });
  it("賣出:已實現損益扣費稅,剩餘成本按均價減", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 2000, price: 500, fee: 1425 }),
      txn({ side: "SELL", quantity: 1000, price: 600, fee: 855, tax: 1800, date: new Date("2026-02-01") }),
    ]);
    // avgCost = 1001425/2000 = 500.7125
    // realized = (600000 - 855 - 1800) - 500.7125*1000 = 597345 - 500712.5 = 96632.5
    expect(p.shares).toBe(1000);
    expect(p.realizedPnl).toBeCloseTo(96632.5, 5);
    expect(p.totalCost).toBeCloseTo(500712.5, 5);
  });
  it("全數出清:shares 0 但保留已實現", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1000, price: 110, date: new Date("2026-02-01") }),
    ]);
    expect(p.shares).toBe(0);
    expect(p.avgCost).toBe(0);
    expect(p.realizedPnl).toBe(10000);
  });
  it("依日期重放(輸入順序無關),同日依 createdAt", () => {
    const sell = txn({ side: "SELL", quantity: 500, price: 110, date: new Date("2026-03-01") });
    const buy = txn({ side: "BUY", quantity: 1000, price: 100, date: new Date("2026-01-01") });
    const [p] = computePositions([sell, buy]);
    expect(p.shares).toBe(500);
  });
  it("多檔分開計算", () => {
    const ps = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "BUY", quantity: 500, price: 50, stockSymbol: "2454" }),
    ]);
    expect(ps.map((p) => p.symbol).sort()).toEqual(["2330", "2454"]);
  });
});

describe("validateNoOversell", () => {
  it("持股足夠:ok", () => {
    expect(validateNoOversell([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1000, price: 110, date: new Date("2026-02-01") }),
    ])).toEqual({ ok: true });
  });
  it("超賣:fail 並指出檔名", () => {
    expect(validateNoOversell([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1500, price: 110, date: new Date("2026-02-01") }),
    ])).toEqual({ ok: false, symbol: "2330" });
  });
  it("時序重放:先賣後買也算超賣", () => {
    expect(validateNoOversell([
      txn({ side: "SELL", quantity: 500, price: 110, date: new Date("2026-01-01") }),
      txn({ side: "BUY", quantity: 1000, price: 100, date: new Date("2026-02-01") }),
    ])).toEqual({ ok: false, symbol: "2330" });
  });
});

describe("computeSummary", () => {
  it("加總市值/成本/未實現/報酬率/已實現", () => {
    const positions = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "BUY", quantity: 1000, price: 50, stockSymbol: "2454" }),
    ]);
    const s = computeSummary(positions, new Map([
      ["2330", { price: 110 }], ["2454", { price: 45 }],
    ]));
    expect(s.marketValue).toBe(155000);
    expect(s.totalCost).toBe(150000);
    expect(s.unrealizedPnl).toBe(5000);
    expect(s.returnPct).toBeCloseTo((5000 / 150000) * 100, 5);
    expect(s.realizedPnl).toBe(0);
  });
  it("缺報價的部位不計入市值/成本/未實現", () => {
    const positions = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "BUY", quantity: 1000, price: 50, stockSymbol: "9999" }),
    ]);
    const s = computeSummary(positions, new Map([["2330", { price: 110 }]]));
    expect(s.marketValue).toBe(110000);
    expect(s.totalCost).toBe(100000);
  });
  it("已實現含已出清部位;空部位不影響市值", () => {
    const positions = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1000, price: 110, date: new Date("2026-02-01") }),
    ]);
    const s = computeSummary(positions, new Map());
    expect(s.marketValue).toBe(0);
    expect(s.realizedPnl).toBe(10000);
    expect(s.returnPct).toBe(0);
  });
});

describe("股利", () => {
  it("現金股利累計為 dividendIncome(扣匯費/補充費),不動股數與成本", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "DIV_CASH", quantity: 1000, price: 2.5, fee: 10, tax: 0, date: new Date("2026-03-01") }),
    ]);
    expect(p.shares).toBe(1000);
    expect(p.totalCost).toBe(100000);
    expect(p.dividendIncome).toBe(2490);
    expect(p.realizedPnl).toBe(0);
  });
  it("配股增加股數,成本不變 → 均價稀釋", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "DIV_STOCK", quantity: 100, price: 0, date: new Date("2026-03-01") }),
    ]);
    expect(p.shares).toBe(1100);
    expect(p.totalCost).toBe(100000);
    expect(p.avgCost).toBeCloseTo(100000 / 1100, 8);
  });
  it("配股後賣出:以稀釋後均價認列已實現", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 110 }),
      txn({ side: "DIV_STOCK", quantity: 100, price: 0, date: new Date("2026-03-01") }),
      txn({ side: "SELL", quantity: 1100, price: 120, date: new Date("2026-04-01") }),
    ]);
    // avgCost = 110000/1100 = 100;realized = 132000 - 100*1100 = 22000
    expect(p.shares).toBe(0);
    expect(p.realizedPnl).toBe(22000);
  });
  it("已出清仍保留股利供加總", () => {
    const [p] = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1000, price: 100, date: new Date("2026-02-01") }),
      txn({ side: "DIV_CASH", quantity: 1000, price: 3, date: new Date("2026-03-01") }),
    ]);
    expect(p.shares).toBe(0);
    expect(p.dividendIncome).toBe(3000);
  });
});

describe("validateNoOversell 股利", () => {
  it("DIV_STOCK 計入持股,其後賣出合法", () => {
    expect(validateNoOversell([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "DIV_STOCK", quantity: 100, price: 0, date: new Date("2026-02-01") }),
      txn({ side: "SELL", quantity: 1100, price: 120, date: new Date("2026-03-01") }),
    ])).toEqual({ ok: true });
  });
  it("移除配股後重放應擋下超賣(模擬刪配股單)", () => {
    expect(validateNoOversell([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "SELL", quantity: 1100, price: 120, date: new Date("2026-03-01") }),
    ])).toEqual({ ok: false, symbol: "2330" });
  });
  it("DIV_CASH 不影響股數", () => {
    expect(validateNoOversell([
      txn({ side: "DIV_CASH", quantity: 1000, price: 2 }),
    ])).toEqual({ ok: true });
  });
});

describe("computeSummary 股利", () => {
  it("加總各檔股利(含已出清)", () => {
    const positions = computePositions([
      txn({ side: "BUY", quantity: 1000, price: 100 }),
      txn({ side: "DIV_CASH", quantity: 1000, price: 2, date: new Date("2026-03-01") }),
      txn({ stockSymbol: "2454", side: "BUY", quantity: 1000, price: 50 }),
      txn({ stockSymbol: "2454", side: "SELL", quantity: 1000, price: 50, date: new Date("2026-02-01") }),
      txn({ stockSymbol: "2454", side: "DIV_CASH", quantity: 1000, price: 1, date: new Date("2026-03-01") }),
    ]);
    const s = computeSummary(positions, new Map([["2330", { price: 100 }]]));
    expect(s.dividendIncome).toBe(3000);
  });
});
