import { describe, it, expect } from "vitest";
import { sharesAsOf, buildDividendSuggestions } from "@/lib/holdings/dividendSuggestions";
import type { Txn } from "@/lib/holdings/positions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let seq = 0;
const txn = (o: Partial<Txn> & { stockSymbol: string; side: Txn["side"]; quantity: number; date: Date }): Txn => ({
  id: `t${++seq}`, price: 100, fee: 0, tax: 0, createdAt: new Date(2020, 0, 1, 0, 0, seq), ...o,
});

describe("sharesAsOf", () => {
  it("重放買/賣/配股至指定日前一刻(嚴格早於);現金股利不影響", () => {
    const txns = [
      txn({ stockSymbol: "2887", side: "BUY", quantity: 2000, date: d("2026-01-10") }),
      txn({ stockSymbol: "2887", side: "SELL", quantity: 1000, date: d("2026-05-01") }),
      txn({ stockSymbol: "2887", side: "DIV_CASH", quantity: 1000, date: d("2026-06-01") }),
    ];
    expect(sharesAsOf(txns, "2887", d("2026-07-21"))).toBe(1000);
    expect(sharesAsOf(txns, "2887", d("2026-01-10"))).toBe(0); // 除權息日=買進日 → 不含
    expect(sharesAsOf(txns, "9999", d("2026-07-21"))).toBe(0);
  });
});

const events = [
  { stockSymbol: "2887", kind: "CASH" as const, exDate: d("2026-07-01"), perShare: 1.2, paymentDate: d("2026-08-19"), year: "114年" },
  { stockSymbol: "2887", kind: "STOCK" as const, exDate: d("2026-07-01"), perShare: 0.1, paymentDate: null, year: "114年" },
  { stockSymbol: "2887", kind: "CASH" as const, exDate: d("2026-12-01"), perShare: 0.5, paymentDate: null, year: "114年" }, // 未來
];

describe("buildDividendSuggestions", () => {
  const buy = txn({ stockSymbol: "2887", side: "BUY", quantity: 3000, date: d("2026-01-10") });

  it("已除息未記帳 → actionable:現金含匯費/健保費,配股 floor 畸零", () => {
    const { actionable, upcoming } = buildDividendSuggestions([buy], events, d("2026-07-09"));
    expect(actionable).toHaveLength(2);
    const cash = actionable.find((s) => s.kind === "CASH")!;
    expect(cash).toMatchObject({ side: "DIV_CASH", sharesAtEx: 3000, quantity: 3000, price: 1.2, amount: 3600, fee: 10, tax: 0, date: "2026-08-19" });
    const stock = actionable.find((s) => s.kind === "STOCK")!;
    expect(stock).toMatchObject({ side: "DIV_STOCK", quantity: 30, price: 0, fee: 0, tax: 0, date: "2026-07-01" }); // 3000×0.1/10=30
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].exDate).toBe("2026-12-01");
  });

  it("健保補充費:單筆 ≥ 2 萬課 2.11%", () => {
    const bigBuy = txn({ stockSymbol: "2887", side: "BUY", quantity: 20000, date: d("2026-01-10") });
    const { actionable } = buildDividendSuggestions([bigBuy], events, d("2026-07-09"));
    const cash = actionable.find((s) => s.kind === "CASH")!;
    expect(cash.amount).toBe(24000);
    expect(cash.tax).toBe(Math.round(24000 * 0.0211));
  });

  it("已記帳(同代號同型別,交易日於 exDate−7..+120 內)→ 不出現", () => {
    const recorded = txn({ stockSymbol: "2887", side: "DIV_CASH", quantity: 3000, price: 1.2, date: d("2026-08-19") });
    const { actionable } = buildDividendSuggestions([buy, recorded], events, d("2026-09-01"));
    expect(actionable.find((s) => s.kind === "CASH")).toBeUndefined();
    expect(actionable.find((s) => s.kind === "STOCK")).toBeDefined();
  });

  it("除權息日持股 0 → 不出現;配股換算 0 股 → 不出現", () => {
    const late = txn({ stockSymbol: "2887", side: "BUY", quantity: 50, date: d("2026-07-05") }); // 除權息(7/1)後才買
    const { actionable, upcoming } = buildDividendSuggestions([late], events, d("2026-07-09"));
    expect(actionable).toHaveLength(0);
    expect(upcoming).toHaveLength(1); // 12/1 前有持股 → 預告仍給(以今日持股>0 判斷)
    const tiny = txn({ stockSymbol: "2887", side: "BUY", quantity: 50, date: d("2026-01-10") }); // 50×0.1/10=0.5→floor 0
    const r2 = buildDividendSuggestions([tiny], events, d("2026-07-09"));
    expect(r2.actionable.filter((s) => s.kind === "STOCK")).toHaveLength(0);
    expect(r2.actionable.filter((s) => s.kind === "CASH")).toHaveLength(1); // 現金 60 元照給
  });
});

describe("季配息不互相誤判(nearest-anchor 分派)", () => {
  // 00878 型季配息 ETF:兩期間隔(exDate 1/1 → 4/1)約 91 天,落在判定窗(−7..+120=127 天)內。
  const quarterly = [
    { stockSymbol: "00878", kind: "CASH" as const, exDate: d("2026-01-01"), perShare: 0.35, paymentDate: d("2026-01-28"), year: "115年" }, // Q1
    { stockSymbol: "00878", kind: "CASH" as const, exDate: d("2026-04-01"), perShare: 0.35, paymentDate: d("2026-04-28"), year: "115年" }, // Q2
  ];
  const holding = txn({ stockSymbol: "00878", side: "BUY", quantity: 10000, date: d("2025-06-01") });

  it("regression:交易日=Q1 payment(1/28),不落在 Q2 窗內 → 僅 Q1 記帳,Q2 仍為 actionable", () => {
    // Q1 窗 [2025-12-25, 2026-05-01] 含 1/28;Q2 窗 [2026-03-25, 2026-07-30] 不含 1/28 → 修法前後皆通過
    const q1Recorded = txn({ stockSymbol: "00878", side: "DIV_CASH", quantity: 10000, price: 0.35, date: d("2026-01-28") });
    const { actionable } = buildDividendSuggestions([holding, q1Recorded], quarterly, d("2026-05-01"));
    expect(actionable).toHaveLength(1);
    expect(actionable[0].exDate).toBe("2026-04-01"); // Q2
  });

  it("修法前會誤判:交易日=Q2 payment(4/28)落在兩期窗內 → 最近錨定應只記 Q2,Q1 仍為 actionable", () => {
    // Q1 窗 [2025-12-25, 2026-05-01] 含 4/28;Q2 窗 [2026-03-25, 2026-07-30] 也含 4/28。
    // 錨定距離:|4/28−1/28|=90 天 vs |4/28−4/28|=0 天 → 最近為 Q2,Q1 不應被視為已記帳。
    // 修法前(單純窗內即記帳):兩期都會被這筆交易標記已記帳 → actionable 會漏掉 Q1(此案為修法前後行為差異的核心斷言)。
    const q2Recorded = txn({ stockSymbol: "00878", side: "DIV_CASH", quantity: 10000, price: 0.35, date: d("2026-04-28") });
    const { actionable } = buildDividendSuggestions([holding, q2Recorded], quarterly, d("2026-05-01"));
    expect(actionable).toHaveLength(1);
    expect(actionable[0].exDate).toBe("2026-01-01"); // Q1 仍待記帳
  });

  it("距離相同(tie)時分派給較早的事件", () => {
    // 兩期錨定(payment)相距 200 天,交易日落在正中間 → 距兩者恰好相等 → 依規則分派給較早事件(Q1)。
    const midDate = new Date((d("2026-01-28").getTime() + d("2026-04-28").getTime()) / 2);
    const tieTxn = txn({ stockSymbol: "00878", side: "DIV_CASH", quantity: 10000, price: 0.35, date: midDate });
    const { actionable } = buildDividendSuggestions([holding, tieTxn], quarterly, d("2026-05-01"));
    expect(actionable).toHaveLength(1);
    expect(actionable[0].exDate).toBe("2026-04-01"); // Q2 仍待記帳(Q1 被 tie 分派記錄)
  });
});

describe("已記帳判定窗邊界(單一事件,不受 nearest-anchor 影響)", () => {
  const single = [
    { stockSymbol: "00878", kind: "CASH" as const, exDate: d("2026-01-01"), perShare: 0.35, paymentDate: null, year: "115年" },
  ];
  const holding = txn({ stockSymbol: "00878", side: "BUY", quantity: 10000, date: d("2025-06-01") });

  it("交易日恰為 exDate−7 → 視為已記帳", () => {
    const boundary = txn({ stockSymbol: "00878", side: "DIV_CASH", quantity: 10000, price: 0.35, date: d("2025-12-25") });
    const { actionable } = buildDividendSuggestions([holding, boundary], single, d("2026-05-01"));
    expect(actionable).toHaveLength(0);
  });

  it("交易日恰為 exDate+120 → 視為已記帳", () => {
    const boundary = txn({ stockSymbol: "00878", side: "DIV_CASH", quantity: 10000, price: 0.35, date: d("2026-05-01") });
    const { actionable } = buildDividendSuggestions([holding, boundary], single, d("2026-05-01"));
    expect(actionable).toHaveLength(0);
  });

  it("健保補充費邊界:現金股利金額恰為 20000 → 稅額 round(20000×0.0211)=422", () => {
    const preciseEvent = [
      { stockSymbol: "00878", kind: "CASH" as const, exDate: d("2026-01-01"), perShare: 2, paymentDate: null, year: "115年" },
    ];
    const buy = txn({ stockSymbol: "00878", side: "BUY", quantity: 10000, date: d("2025-06-01") }); // 10000×2=20000
    const { actionable } = buildDividendSuggestions([buy], preciseEvent, d("2026-05-01"));
    expect(actionable).toHaveLength(1);
    expect(actionable[0].amount).toBe(20000);
    expect(actionable[0].tax).toBe(Math.round(20000 * 0.0211));
    expect(actionable[0].tax).toBe(422);
  });
});
