# FinMind 整合 M3:除權息建議卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持股 × 除權息行事曆比對,`/holdings` 顯示建議卡(已除息未記帳→一鍵帶入交易表單;未來事件→預告),記帳仍由使用者確認。

**Architecture:** 新表 `DividendEvent`(FinMind `TaiwanStockDividend` 逐檔抓持股∪自選,週更 cron);建議產生為純函式(`lib/holdings/dividendSuggestions.ts`:股數重放/已記帳判定/金額與費稅估算);`/api/holdings/dividend-suggestions` 回建議;前端卡片點擊 → `AddTransaction` 以 prefill props 開啟預填。**無交易狀態機、不自動寫入交易。**

**Tech Stack:** Next.js 16 / TS strict / Prisma / Vitest;FinMind client 層(M1)。

**Spec:** `docs/superpowers/specs/2026-07-08-nazodex-finmind-integration-design.md`(M3 節)

## Global Constraints

- TDD;vitest 中文 it;`pnpm test` 全綠 + `tsc --noEmit` 再 commit。
- **實測欄位(2026-07-09,data_id=2887)**:`year:"114年"`、`StockEarningsDistribution:0.1`(股票股利**面額元/股**,每股配 `值/10` 股)、`StockExDividendTradingDate:"2026-07-21"`、`CashEarningsDistribution:1.0`(元/股)、`CashExDividendTradingDate`、`CashDividendPaymentDate:"2026-08-19"`(發放日,現金才有);另有 `CashStatutorySurplus`/`StockStatutorySurplus`(公積配發,常為 0,**須與盈餘配發相加**)。
- 現金/股票除權息日不同 → 各自一列(kind CASH|STOCK),對映 `DIV_CASH`/`DIV_STOCK`。
- 已記帳判定窗:交易日在 `[exDate−7, exDate+120]` 天內(**與 spec 的 ±30 不同,刻意放寬**:現金股利發放日常在除息後 1 個月以上,使用者常以入帳日記帳)。
- 金額/費稅:現金 = 股數×perShare,fee=匯費 10、tax=健保補充費(`estimateNhi`);配股股數 = `floor(股數×perShare/10)`(畸零股捨去,現實的畸零找零不做——YAGNI),fee/tax=0。
- 建議卡不出現的情況:除權息日前一日持股為 0、已記帳、換算股數/金額 ≤ 0。

---

### Task 1: DividendEvent 表(migration 0006)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0006_add_dividend_event/`(migrate dev 產生後改名為序號慣例)

**Interfaces:**
- Produces: `prisma.dividendEvent`。

- [ ] **Step 1: schema 檔尾加 model**

```prisma
model DividendEvent {
  id          String    @id @default(cuid())
  stockSymbol String
  kind        String    // "CASH" | "STOCK"
  exDate      DateTime  @db.Date  // 除息/除權交易日
  perShare    Float     // CASH:元/股(盈餘+公積);STOCK:股票股利面額元/股(每股配 perShare/10 股)
  paymentDate DateTime? @db.Date  // 現金股利發放日(公告才有;STOCK 為 null)
  year        String    // 股利所屬年度,如 "114年"
  @@unique([stockSymbol, exDate, kind])
  @@index([exDate])
}
```

- [ ] **Step 2: 拋棄式 MySQL 產 migration(同 M2 Task 1 模式)**

```bash
docker run -d --name nazodex-migrate-db -e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=nazodex_dev -p 3311:3306 mysql:8
until docker exec nazodex-migrate-db mysqladmin ping -h localhost -pdev --silent 2>/dev/null; do sleep 2; done
DATABASE_URL="mysql://root:dev@127.0.0.1:3311/nazodex_dev" pnpm exec prisma migrate dev --name add_dividend_event
docker rm -f nazodex-migrate-db
git mv prisma/migrations/*_add_dividend_event prisma/migrations/0006_add_dividend_event
```

(改名為 0006 序號——與 0005 同慣例;此 migration 尚未套用到任何真 DB,改名安全。)

- [ ] **Step 3: 驗證 + Commit**

`pnpm exec tsc --noEmit`;`pnpm test` 全綠。

```bash
git add prisma
git commit -m "feat: DividendEvent 表——現金/配股各一列、除權息日+發放日、無 FK 直查"
```

---

### Task 2: FinMind 除權息 dataset 封裝

**Files:**
- Modify: `lib/finmind/datasets.ts`
- Test: `lib/finmind/__tests__/datasets.test.ts`(追加 describe)

**Interfaces:**
- Produces:
  - `FinMindDividendEvent = { symbol: string; kind: "CASH" | "STOCK"; exDate: string; perShare: number; paymentDate: string | null; year: string }`
  - `parseDividends(raw: unknown[]): FinMindDividendEvent[]`
  - `getDividends(client, symbol, startDate): Promise<FinMindDividendEvent[]>`(dataset `TaiwanStockDividend`,data_id+start_date)

- [ ] **Step 1: 失敗測試(追加到 datasets.test.ts)**

```ts
import { parseDividends, getDividends } from "@/lib/finmind/datasets";

const dividendRaw = [
  { // 現金+配股同公告(台新金型)
    date: "2026-07-27", stock_id: "2887", year: "114年",
    StockEarningsDistribution: 0.1, StockStatutorySurplus: 0,
    StockExDividendTradingDate: "2026-07-21",
    CashEarningsDistribution: 1.0, CashStatutorySurplus: 0.2,
    CashExDividendTradingDate: "2026-07-21", CashDividendPaymentDate: "2026-08-19",
  },
  { // 純現金、無配股(台積電型;配股欄 0/空)
    date: "2026-06-01", stock_id: "2330", year: "115年",
    StockEarningsDistribution: 0, StockExDividendTradingDate: "",
    CashEarningsDistribution: 4.5, CashExDividendTradingDate: "2026-06-16", CashDividendPaymentDate: "2026-07-10",
  },
  { // 髒列:兩者皆無日期 → 不產生事件
    date: "2020-01-01", stock_id: "9999", year: "108年", CashEarningsDistribution: 0, StockEarningsDistribution: 0 },
];

describe("parseDividends", () => {
  it("現金與配股拆成獨立事件;盈餘+公積相加;發放日僅現金有", () => {
    const events = parseDividends(dividendRaw);
    const e2887 = events.filter((e) => e.symbol === "2887");
    expect(e2887).toHaveLength(2);
    const cash = e2887.find((e) => e.kind === "CASH")!;
    expect(cash).toEqual({ symbol: "2887", kind: "CASH", exDate: "2026-07-21", perShare: 1.2, paymentDate: "2026-08-19", year: "114年" });
    const stock = e2887.find((e) => e.kind === "STOCK")!;
    expect(stock.perShare).toBeCloseTo(0.1);
    expect(stock.paymentDate).toBeNull();
    expect(events.filter((e) => e.symbol === "2330")).toHaveLength(1);
    expect(events.filter((e) => e.symbol === "9999")).toHaveLength(0);
  });
  it("getDividends 帶 dataset/data_id/start_date", async () => {
    const fetchDataset = vi.fn(async () => dividendRaw);
    const client = { fetchDataset } as unknown as FinMindClient;
    await getDividends(client, "2887", "2025-07-09");
    expect(fetchDataset).toHaveBeenCalledWith({ dataset: "TaiwanStockDividend", data_id: "2887", start_date: "2025-07-09" });
  });
});
```

- [ ] **Step 2: RED** → `pnpm exec vitest run lib/finmind`

- [ ] **Step 3: 實作(datasets.ts 追加)**

```ts
export type FinMindDividendEvent = {
  symbol: string;
  kind: "CASH" | "STOCK";
  exDate: string;              // ISO 除息/除權交易日
  perShare: number;            // CASH:元/股;STOCK:面額元/股(每股配 perShare/10 股)
  paymentDate: string | null;  // 現金發放日
  year: string;                // 股利所屬年度("114年")
};

type RawDividend = Record<string, unknown>;

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const numOr0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseDividends(raw: unknown[]): FinMindDividendEvent[] {
  const out: FinMindDividendEvent[] = [];
  for (const r of raw as RawDividend[]) {
    const symbol = String(r.stock_id ?? "").trim();
    const year = String(r.year ?? "").trim();
    if (!symbol) continue;
    const cash = numOr0(r.CashEarningsDistribution) + numOr0(r.CashStatutorySurplus);
    if (cash > 0 && isIsoDate(r.CashExDividendTradingDate)) {
      out.push({
        symbol, kind: "CASH", exDate: r.CashExDividendTradingDate, perShare: cash,
        paymentDate: isIsoDate(r.CashDividendPaymentDate) ? r.CashDividendPaymentDate : null, year,
      });
    }
    const stock = numOr0(r.StockEarningsDistribution) + numOr0(r.StockStatutorySurplus);
    if (stock > 0 && isIsoDate(r.StockExDividendTradingDate)) {
      out.push({ symbol, kind: "STOCK", exDate: r.StockExDividendTradingDate, perShare: stock, paymentDate: null, year });
    }
  }
  return out;
}

export async function getDividends(client: FinMindClient, symbol: string, startDate: string): Promise<FinMindDividendEvent[]> {
  const raw = await client.fetchDataset({ dataset: "TaiwanStockDividend", data_id: symbol, start_date: startDate });
  return parseDividends(raw);
}
```

- [ ] **Step 4: GREEN** → `pnpm test`;`tsc --noEmit`。

- [ ] **Step 5: Commit**

```bash
git add lib/finmind
git commit -m "feat: FinMind 除權息封裝——現金/配股拆事件、盈餘+公積相加、發放日"
```

---

### Task 3: 除權息 ingest 腳本

**Files:**
- Create: `scripts/ingest-dividends.ts`
- Modify: `package.json`(`"ingest:dividends": "tsx scripts/ingest-dividends.ts"`)
- Modify: `Dockerfile`(同模式編 `dist/ingest-dividends.mjs`)

**Interfaces:**
- Consumes: `createFinMindClient`、`getDividends`(Task 2)、`prisma`。
- Produces: CLI `pnpm ingest:dividends`——持股∪自選 distinct 股票逐檔抓近 1 年起的公告(含未來事件),upsert `DividendEvent`。

IO 編排無新單元測試(scripts 慣例);smoke 於 Task 6。

- [ ] **Step 1: 實作**

```ts
import { prisma } from "@/lib/prisma";
import { createFinMindClient } from "@/lib/finmind/client";
import { getDividends } from "@/lib/finmind/datasets";

async function main() {
  const [watch, held] = await Promise.all([
    prisma.watchlistItem.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
    prisma.holdingTransaction.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
  ]);
  const symbols = [...new Set([...watch, ...held].map((r) => r.stockSymbol))].sort();
  const startIso = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  console.log(`dividends: ${symbols.length} symbols, since ${startIso}`);

  const client = createFinMindClient();
  const failures: string[] = [];
  let eventCount = 0;
  for (const symbol of symbols) {
    try {
      const events = await getDividends(client, symbol, startIso);
      for (const e of events) {
        const exDate = new Date(`${e.exDate}T00:00:00Z`);
        const paymentDate = e.paymentDate ? new Date(`${e.paymentDate}T00:00:00Z`) : null;
        await prisma.dividendEvent.upsert({
          where: { stockSymbol_exDate_kind: { stockSymbol: e.symbol, exDate, kind: e.kind } },
          create: { stockSymbol: e.symbol, kind: e.kind, exDate, perShare: e.perShare, paymentDate, year: e.year },
          update: { perShare: e.perShare, paymentDate, year: e.year }, // 公告更正覆寫
        });
        eventCount++;
      }
      console.log(`${symbol}: ${events.length} events`);
    } catch (err) {
      failures.push(`${symbol}: ${(err as Error).message}`);
    }
  }
  console.log(`done, ${eventCount} events upserted`);
  if (failures.length) {
    console.error(`failures (${failures.length}):\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

`package.json` scripts 加 `"ingest:dividends": "tsx scripts/ingest-dividends.ts"`;`Dockerfile` 於 ingest-fundamentals 區塊後加同參數 esbuild 步驟(註解:`# 除權息行事曆(持股∪自選)ingest;CronJob 每週一 17:00 台北跑 dist/ingest-dividends.mjs`)。

- [ ] **Step 2: 驗證** `tsc --noEmit`;`pnpm test`;esbuild 打包指令成功。

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest-dividends.ts package.json Dockerfile
git commit -m "feat: 除權息 ingest——持股∪自選逐檔、含未來公告、upsert 覆寫更正"
```

---

### Task 4: 建議產生純函式

**Files:**
- Create: `lib/holdings/dividendSuggestions.ts`
- Test: `lib/holdings/__tests__/dividendSuggestions.test.ts`

**Interfaces:**
- Consumes: `Txn`/`Side`(`lib/holdings/positions`)、`DIV_TRANSFER_FEE`/`estimateNhi`(`lib/holdings/fees`)。
- Produces:
  - `DividendEventLike = { stockSymbol: string; kind: "CASH" | "STOCK"; exDate: Date; perShare: number; paymentDate: Date | null; year: string }`
  - `DividendSuggestion = { symbol: string; kind: "CASH" | "STOCK"; side: "DIV_CASH" | "DIV_STOCK"; exDate: string; year: string; sharesAtEx: number; quantity: number; price: number; amount: number; fee: number; tax: number; date: string }`
  - `sharesAsOf(txns: Txn[], symbol: string, date: Date): number`(重放至 date **前一日**含當日之前——嚴格 `txn.date < date`)
  - `buildDividendSuggestions(txns: Txn[], events: DividendEventLike[], today: Date): { actionable: DividendSuggestion[]; upcoming: DividendSuggestion[] }`

- [ ] **Step 1: 失敗測試**

```ts
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
```

- [ ] **Step 2: RED** → `pnpm exec vitest run lib/holdings`

- [ ] **Step 3: 實作**

```ts
import type { Txn } from "@/lib/holdings/positions";
import { DIV_TRANSFER_FEE, estimateNhi } from "@/lib/holdings/fees";

export type DividendEventLike = {
  stockSymbol: string; kind: "CASH" | "STOCK";
  exDate: Date; perShare: number; paymentDate: Date | null; year: string;
};

export type DividendSuggestion = {
  symbol: string; kind: "CASH" | "STOCK"; side: "DIV_CASH" | "DIV_STOCK";
  exDate: string; year: string;
  sharesAtEx: number; quantity: number; price: number; amount: number;
  fee: number; tax: number; date: string;
};

// 除權息日前一日的持股:重放嚴格早於 date 的交易(現金股利不影響股數)
export function sharesAsOf(txns: Txn[], symbol: string, date: Date): number {
  let shares = 0;
  for (const t of txns) {
    if (t.stockSymbol !== symbol || t.side === "DIV_CASH") continue;
    if (t.date.getTime() >= date.getTime()) continue;
    shares += t.side === "SELL" ? -t.quantity : t.quantity;
  }
  return shares;
}

const RECORD_WINDOW_BEFORE = 7 * 86_400_000;
const RECORD_WINDOW_AFTER = 120 * 86_400_000; // 現金發放常在除息後 1 個月+,使用者可能以入帳日記帳

function isRecorded(txns: Txn[], e: DividendEventLike): boolean {
  const side = e.kind === "CASH" ? "DIV_CASH" : "DIV_STOCK";
  return txns.some(
    (t) => t.stockSymbol === e.stockSymbol && t.side === side &&
      t.date.getTime() >= e.exDate.getTime() - RECORD_WINDOW_BEFORE &&
      t.date.getTime() <= e.exDate.getTime() + RECORD_WINDOW_AFTER,
  );
}

const iso = (dt: Date) => dt.toISOString().slice(0, 10);

function toSuggestion(e: DividendEventLike, sharesAtEx: number): DividendSuggestion | null {
  if (e.kind === "CASH") {
    const amount = Math.round(sharesAtEx * e.perShare);
    if (amount <= 0) return null;
    return {
      symbol: e.stockSymbol, kind: "CASH", side: "DIV_CASH", exDate: iso(e.exDate), year: e.year,
      sharesAtEx, quantity: sharesAtEx, price: e.perShare, amount,
      fee: DIV_TRANSFER_FEE, tax: estimateNhi(amount),
      date: iso(e.paymentDate ?? e.exDate),
    };
  }
  const shares = Math.floor((sharesAtEx * e.perShare) / 10); // 面額 10 元:股票股利 X 元 = 每股配 X/10 股;畸零捨去
  if (shares <= 0) return null;
  return {
    symbol: e.stockSymbol, kind: "STOCK", side: "DIV_STOCK", exDate: iso(e.exDate), year: e.year,
    sharesAtEx, quantity: shares, price: 0, amount: 0, fee: 0, tax: 0, date: iso(e.exDate),
  };
}

export function buildDividendSuggestions(
  txns: Txn[], events: DividendEventLike[], today: Date,
): { actionable: DividendSuggestion[]; upcoming: DividendSuggestion[] } {
  const actionable: DividendSuggestion[] = [];
  const upcoming: DividendSuggestion[] = [];
  for (const e of [...events].sort((a, b) => a.exDate.getTime() - b.exDate.getTime())) {
    if (e.exDate.getTime() <= today.getTime()) {
      if (isRecorded(txns, e)) continue;
      const s = toSuggestion(e, sharesAsOf(txns, e.stockSymbol, e.exDate));
      if (s) actionable.push(s);
    } else {
      // 未來事件:以今日持股估算預告(僅展示,不可帶入)
      const s = toSuggestion(e, sharesAsOf(txns, e.stockSymbol, today));
      if (s) upcoming.push(s);
    }
  }
  return { actionable, upcoming };
}
```

註:`sharesAsOf` 不依 createdAt 排序重放——加總與順序無關(只算淨股數,超賣驗證由既有機制把關)。

- [ ] **Step 4: GREEN** → `pnpm test`;`tsc --noEmit`。

- [ ] **Step 5: Commit**

```bash
git add lib/holdings
git commit -m "feat: 除權息建議純函式——股數重放/已記帳判定(−7..+120天)/現金費稅與配股畸零換算"
```

---

### Task 5: API + 建議卡 UI + 表單預填

**Files:**
- Create: `app/api/holdings/dividend-suggestions/route.ts`
- Create: `components/holdings/DividendSuggestions.tsx`
- Modify: `components/holdings/AddTransaction.tsx`(加 `prefill`/`onPrefillConsumed` props)
- Modify: `components/holdings/HoldingsView.tsx`(掛建議卡 + prefill state)
- Test: `components/holdings/__tests__/DividendSuggestions.test.tsx`

**Interfaces:**
- Consumes: `buildDividendSuggestions`(Task 4)、`prisma.dividendEvent`(Task 1)、既有 `/api/holdings` auth 模式(參考該 route 的 session 驗證寫法)。
- Produces:
  - `GET /api/holdings/dividend-suggestions` → `{ actionable: DividendSuggestion[], upcoming: DividendSuggestion[] }`(session userId 過濾交易;未登入 401——照抄既有 holdings route 的 auth 慣例)
  - `AddTransaction` 新 props:`prefill?: TxPrefill | null; onPrefillConsumed?: () => void`,`TxPrefill = { symbol: string; name: string; side: Side; quantity: number; price: number; date: string; fee: number; tax: number }`——prefill 變化(非 null)時:開啟表單、填入所有欄位、`feeTouched=true`(費稅來自建議,不要被自動重估蓋掉)、呼叫 `onPrefillConsumed`。
  - `DividendSuggestions` props:`{ onPrefill: (p: TxPrefill) => void; refreshKey: number }`——`refreshKey` 變化時重抓。

- [ ] **Step 1: 失敗測試(component)**

`components/holdings/__tests__/DividendSuggestions.test.tsx`(mock fetch,沿用既有 component 測試模式):
- 有 actionable → 顯示「2887 於 2026-07-01 除息 1.2 元/股,依除息日持股 3,000 股估計 3,600 元」之類文案(斷言關鍵數字與「帶入記帳」按鈕),點擊呼叫 `onPrefill`(斷言收到 side/quantity/price/fee/tax/date)。
- 配股卡顯示「除權 …每股配 0.01 股,估配 30 股」與帶入按鈕。
- upcoming → 「即將除息」區塊,無帶入按鈕。
- 兩者皆空 → 不渲染任何節點。

- [ ] **Step 2: RED**

- [ ] **Step 3: 實作**

`route.ts`(依 `app/api/holdings/route.ts` 的 auth/錯誤慣例):

```ts
// session 驗證(照既有 holdings route);
// txns = prisma.holdingTransaction.findMany({ where: { userId } })(轉 Txn shape)
// heldSymbols = txns 的 distinct stockSymbol
// events = prisma.dividendEvent.findMany({ where: { stockSymbol: { in: heldSymbols }, exDate: { gte: new Date(Date.now() - 200*86_400_000) } } })
//   (近 200 天 + 未來;actionable 窗最長 120 天,再往前的事件必然已記帳或放棄)
// return Response.json(buildDividendSuggestions(txns, events, new Date()))
```

`DividendSuggestions.tsx`("use client"):fetch 一次 + refreshKey 重抓;卡片區塊:
- actionable 卡(琥珀邊框 `border-amber-500/30`):標題「{name || symbol} 除息/除權」、內文「{exDate} 除息 {perShare} 元/股 × 除息日持股 {sharesAtEx} 股 ≈ {amount} 元(扣費稅後入帳約 {amount-fee-tax} 元)」或配股「每股配 {perShare/10} 股,估配 {quantity} 股」、右側「帶入記帳」按鈕 → `onPrefill({...})`(name 由建議 API 不帶——按鈕帶 symbol 當 name fallback,或 route join Stock.name 一併回傳,擇後者:route 以 `prisma.stock.findMany({ where: { symbol: { in: ... } } })` 補 name)。
- upcoming 區(灰調):「即將除權息」列表,只展示。
- 金額顯示用 `lib/format` 既有 formatter;顏色不用紅綠(股利非漲跌語意,用琥珀 `text-amber-400` 同 AddTransaction 的股利選項)。

`AddTransaction.tsx`:新 props;`useEffect(() => { if (!prefill) return; setOpen(true); setPicked({ symbol: prefill.symbol, name: prefill.name }); setSide(prefill.side); setQuantity(String(prefill.quantity)); setPrice(prefill.side === "DIV_STOCK" ? "" : String(prefill.price)); setDate(prefill.date); setFee(String(prefill.fee)); setTax(String(prefill.tax)); setFeeTouched(true); onPrefillConsumed?.(); }, [prefill])`。

`HoldingsView.tsx`:`const [prefill, setPrefill] = useState<TxPrefill | null>(null); const [sugKey, setSugKey] = useState(0);`;`<AddTransaction prefill={prefill} onPrefillConsumed={() => setPrefill(null)} onAdded={() => { load(); setSugKey(k => k + 1); }} .../>`;`<DividendSuggestions onPrefill={setPrefill} refreshKey={sugKey} />` 置於 AddTransaction 之後、SummaryBar 之前。

- [ ] **Step 4: GREEN** → `pnpm exec vitest run components/holdings`;`pnpm test`;`tsc --noEmit`;`pnpm build`。

- [ ] **Step 5: Commit**

```bash
git add app/api/holdings components/holdings
git commit -m "feat: 除權息建議卡——API(session 過濾)+卡片 UI+一鍵帶入交易表單預填"
```

---

### Task 6: 全量驗證 + smoke + 文件

- [ ] **Step 1:** `pnpm test && pnpm exec tsc --noEmit && pnpm build`
- [ ] **Step 2(controller):** 隧道跑 `pnpm ingest:dividends`(持股∪自選,呼叫數個位數);DB 抽查 DividendEvent;prod 部署後開 /holdings 驗卡片與帶入流程。
- [ ] **Step 3: 文件**:CLAUDE.md(指令 `pnpm ingest:dividends`;持股損益 bullet 補「除權息建議卡(DividendEvent 週更,FinMind)」;路線圖第 1 項更新);README 路線圖同步。
- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: M3 除權息建議卡上線——ingest:dividends 與持股功能說明"
```
