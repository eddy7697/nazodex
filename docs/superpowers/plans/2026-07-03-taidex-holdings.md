# 持股損益追蹤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交易流水帳式持股損益追蹤——記錄買賣、平均成本法推導部位、未實現/已實現損益、總資產，頁面 `/holdings`。

**Architecture:** `HoldingTransaction`（Prisma/MySQL）為唯一事實來源；`lib/holdings/` 純函式（fees、positions）+ service（userId 隔離 CRUD + 超賣驗證）；API 三條 route 接 `getQuotes()` 報價；前端沿用 watchlist 的卡片/表格響應式 + 60s 輪詢模式。

**Tech Stack:** Next.js App Router、Prisma + MySQL 8、Auth.js v5、Vitest、Tailwind。

## Global Constraints

- 紅漲綠跌：損益顏色一律 `changeColorClass`（`lib/format.ts`），元件不得寫死 hex。
- 每個 DB 查詢都以 session `userId` 過濾。
- 金額顯示用 `lib/format.ts`；數量單位為「股」。
- TDD：先寫失敗測試。pnpm、TypeScript strict。
- 手續費 `max(20, round(金額×0.001425))`；賣出證交稅 `round(金額×0.003)`。
- 平均成本法；交易依 `date` 升冪、同日依 `createdAt` 升冪重放。

---

### Task 1: 費用估算 `lib/holdings/fees.ts`

**Files:**
- Create: `lib/holdings/fees.ts`
- Test: `lib/holdings/__tests__/fees.test.ts`

**Interfaces:**
- Produces: `estimateFee(price: number, quantity: number): number`、`estimateTax(price: number, quantity: number): number`（皆回傳整數元）

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/holdings/__tests__/fees.test.ts
import { describe, it, expect } from "vitest";
import { estimateFee, estimateTax } from "@/lib/holdings/fees";

describe("estimateFee", () => {
  it("0.1425% 四捨五入", () => {
    // 600 * 1000 * 0.001425 = 855
    expect(estimateFee(600, 1000)).toBe(855);
  });
  it("最低 20 元", () => {
    // 10 * 100 * 0.001425 = 1.425 → 20
    expect(estimateFee(10, 100)).toBe(20);
  });
  it("小數四捨五入", () => {
    // 23.5 * 1000 * 0.001425 = 33.4875 → 33
    expect(estimateFee(23.5, 1000)).toBe(33);
  });
});

describe("estimateTax", () => {
  it("0.3% 四捨五入", () => {
    expect(estimateTax(600, 1000)).toBe(1800);
    // 23.5 * 1000 * 0.003 = 70.5 → 71
    expect(estimateTax(23.5, 1000)).toBe(71);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- --run lib/holdings/__tests__/fees.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 3: 最小實作**

```ts
// lib/holdings/fees.ts
// 台股一般券商牌告費率;使用者若有折扣可在表單覆寫。
const FEE_RATE = 0.001425;
const MIN_FEE = 20;
const TAX_RATE = 0.003;

export function estimateFee(price: number, quantity: number): number {
  return Math.max(MIN_FEE, Math.round(price * quantity * FEE_RATE));
}

export function estimateTax(price: number, quantity: number): number {
  return Math.round(price * quantity * TAX_RATE);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- --run lib/holdings/__tests__/fees.test.ts` → PASS

- [ ] **Step 5: Commit** `git add lib/holdings && git commit -m "feat: 台股手續費/證交稅估算"`

---

### Task 2: 金額格式 `fmtMoney` / `fmtSignedMoney`

**Files:**
- Modify: `lib/format.ts`
- Test: `lib/__tests__/format.test.ts`（追加）

**Interfaces:**
- Produces: `fmtMoney(n: number): string`（四捨五入整數千分位）、`fmtSignedMoney(n: number): string`（正數帶 `+`）

- [ ] **Step 1: 追加失敗測試**（加到既有 describe 之後）

```ts
describe("fmtMoney", () => {
  it("整數千分位", () => {
    expect(fmtMoney(1234567.4)).toBe("1,234,567");
  });
  it("負數", () => {
    expect(fmtMoney(-500.6)).toBe("-501");
  });
});

describe("fmtSignedMoney", () => {
  it("正數帶 +", () => {
    expect(fmtSignedMoney(1500)).toBe("+1,500");
  });
  it("負數", () => {
    expect(fmtSignedMoney(-1500)).toBe("-1,500");
  });
  it("零不帶符號", () => {
    expect(fmtSignedMoney(0)).toBe("0");
  });
});
```

（import 行改為 `import { changeColorClass, fmtPrice, fmtPct, fmtSignedPct, fmtMoney, fmtSignedMoney } from "@/lib/format";`）

- [ ] **Step 2: 跑測試失敗** `pnpm test -- --run lib/__tests__/format.test.ts` → FAIL

- [ ] **Step 3: 實作**（追加到 `lib/format.ts`）

```ts
export function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
export function fmtSignedMoney(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : ""}${r.toLocaleString("en-US")}`;
}
```

- [ ] **Step 4: 跑測試通過**
- [ ] **Step 5: Commit** `git commit -m "feat: fmtMoney/fmtSignedMoney 金額格式"`

---

### Task 3: 部位推導核心 `lib/holdings/positions.ts`

**Files:**
- Create: `lib/holdings/positions.ts`
- Test: `lib/holdings/__tests__/positions.test.ts`

**Interfaces:**
- Produces:

```ts
export type Side = "BUY" | "SELL";
export type Txn = {
  id: string; stockSymbol: string; side: Side; quantity: number;
  price: number; fee: number; tax: number; date: Date; createdAt: Date;
};
export type Position = {
  symbol: string; shares: number; totalCost: number;
  avgCost: number; realizedPnl: number;
};
export type Summary = {
  marketValue: number; totalCost: number; unrealizedPnl: number;
  returnPct: number; realizedPnl: number;
};
export function computePositions(txns: Txn[]): Position[];
export function validateNoOversell(txns: Txn[]): { ok: true } | { ok: false; symbol: string };
export function computeSummary(positions: Position[], quotes: Map<string, { price: number }>): Summary;
```

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/holdings/__tests__/positions.test.ts
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
      avgCost: 600.855, realizedPnl: 0,
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
      txn({ side: "BUY", quantity: 1000, price: 100 }),          // 2330 cost 100000
      txn({ side: "BUY", quantity: 1000, price: 50, stockSymbol: "2454" }), // cost 50000
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
```

- [ ] **Step 2: 跑測試失敗** `pnpm test -- --run lib/holdings/__tests__/positions.test.ts`

- [ ] **Step 3: 實作**

```ts
// lib/holdings/positions.ts
export type Side = "BUY" | "SELL";

export type Txn = {
  id: string;
  stockSymbol: string;
  side: Side;
  quantity: number;   // 股數
  price: number;      // 每股成交價
  fee: number;        // 手續費(元)
  tax: number;        // 證交稅(元)
  date: Date;         // 成交日
  createdAt: Date;    // 同日交易的次序依此
};

export type Position = {
  symbol: string;
  shares: number;
  totalCost: number;    // 剩餘持股的總成本(含買進手續費)
  avgCost: number;      // totalCost / shares(空手為 0)
  realizedPnl: number;  // 已實現損益(扣賣出費稅)
};

export type Summary = {
  marketValue: number;
  totalCost: number;
  unrealizedPnl: number;
  returnPct: number;    // 未實現 / 成本 * 100
  realizedPnl: number;
};

function chronological(txns: Txn[]): Txn[] {
  return [...txns].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export function computePositions(txns: Txn[]): Position[] {
  const bySymbol = new Map<string, { shares: number; totalCost: number; realizedPnl: number }>();
  for (const t of chronological(txns)) {
    const pos = bySymbol.get(t.stockSymbol) ?? { shares: 0, totalCost: 0, realizedPnl: 0 };
    if (t.side === "BUY") {
      pos.shares += t.quantity;
      pos.totalCost += t.quantity * t.price + t.fee;
    } else {
      const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
      pos.realizedPnl += t.quantity * t.price - t.fee - t.tax - avgCost * t.quantity;
      pos.shares -= t.quantity;
      pos.totalCost -= avgCost * t.quantity;
    }
    bySymbol.set(t.stockSymbol, pos);
  }
  return [...bySymbol.entries()].map(([symbol, p]) => ({
    symbol,
    shares: p.shares,
    totalCost: p.totalCost,
    avgCost: p.shares > 0 ? p.totalCost / p.shares : 0,
    realizedPnl: p.realizedPnl,
  }));
}

export function validateNoOversell(txns: Txn[]): { ok: true } | { ok: false; symbol: string } {
  const shares = new Map<string, number>();
  for (const t of chronological(txns)) {
    const cur = shares.get(t.stockSymbol) ?? 0;
    const next = t.side === "BUY" ? cur + t.quantity : cur - t.quantity;
    if (next < 0) return { ok: false, symbol: t.stockSymbol };
    shares.set(t.stockSymbol, next);
  }
  return { ok: true };
}

export function computeSummary(
  positions: Position[],
  quotes: Map<string, { price: number }>,
): Summary {
  let marketValue = 0;
  let totalCost = 0;
  let realizedPnl = 0;
  for (const p of positions) {
    realizedPnl += p.realizedPnl;
    if (p.shares <= 0) continue;
    const quote = quotes.get(p.symbol);
    if (!quote) continue; // 無報價(如下市):不計入市值與未實現,前端另行標示
    marketValue += quote.price * p.shares;
    totalCost += p.totalCost;
  }
  const unrealizedPnl = marketValue - totalCost;
  return {
    marketValue,
    totalCost,
    unrealizedPnl,
    returnPct: totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0,
    realizedPnl,
  };
}
```

- [ ] **Step 4: 跑測試通過**
- [ ] **Step 5: Commit** `git commit -m "feat: 平均成本法部位推導/超賣驗證/總覽計算"`

---

### Task 4: Prisma schema + migration 0003

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0003_add_holding_transaction/migration.sql`

**Interfaces:**
- Produces: `prisma.holdingTransaction`（model 如下）

- [ ] **Step 1: schema 加 model**（`User` 加 `transactions HoldingTransaction[]`）

```prisma
model HoldingTransaction {
  id          String   @id @default(cuid())
  userId      String
  stockSymbol String
  side        String   // "BUY" | "SELL"
  quantity    Int      // 股數
  price       Float    // 每股成交價
  fee         Int      @default(0) // 手續費(元)
  tax         Int      @default(0) // 證交稅(元,賣出才有)
  date        DateTime @db.Date    // 成交日
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, stockSymbol])
}
```

- [ ] **Step 2: 離線產 migration SQL**（無 DB 連線用 `migrate diff`）

```bash
git stash -- prisma/schema.prisma  # 或以 git show HEAD:prisma/schema.prisma 存舊檔
pnpm exec prisma migrate diff \
  --from-schema-datamodel /tmp/old-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0003_add_holding_transaction/migration.sql
```

Expected: `CREATE TABLE HoldingTransaction ... INDEX ... FOREIGN KEY ...`

- [ ] **Step 3: `pnpm exec prisma generate`** → client 有 `holdingTransaction`
- [ ] **Step 4: `pnpm exec tsc --noEmit`** → 無錯
- [ ] **Step 5: Commit** `git commit -m "feat: HoldingTransaction model + migration 0003"`

---

### Task 5: `lib/holdings/service.ts`

**Files:**
- Create: `lib/holdings/service.ts`
- Test: `lib/holdings/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `computePositions`、`validateNoOversell`（Task 3）
- Produces:

```ts
export class OversellError extends Error {}
export type NewTxnInput = {
  symbol: string; side: Side; quantity: number; price: number;
  fee: number; tax: number; date: Date;
};
export function listTransactions(userId: string, symbol?: string, p?: P): Promise<Txn[]>;
export function addTransaction(userId: string, input: NewTxnInput, p?: P): Promise<void>; // 超賣擲 OversellError
export function deleteTransaction(userId: string, id: string, p?: P): Promise<"deleted" | "not_found">; // 刪後超賣擲 OversellError
export function getPositions(userId: string, p?: P): Promise<Position[]>;
```

- [ ] **Step 1: 寫失敗測試**（mock prisma，仿 `lib/watchlist/__tests__/service.test.ts`）

```ts
// lib/holdings/__tests__/service.test.ts
import { describe, it, expect } from "vitest";
import {
  listTransactions, addTransaction, deleteTransaction, getPositions, OversellError,
} from "@/lib/holdings/service";

function makeMock() {
  const db: any[] = [];
  let seq = 0;
  return {
    _db: db,
    holdingTransaction: {
      findMany: async ({ where }: any) => {
        let rows = db.filter((r) => r.userId === where.userId);
        if (where.stockSymbol) rows = rows.filter((r) => r.stockSymbol === where.stockSymbol);
        return rows.map((r) => ({ ...r }));
      },
      findFirst: async ({ where }: any) => {
        const row = db.find((r) => r.id === where.id && r.userId === where.userId);
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => {
        seq += 1;
        db.push({ id: `t${seq}`, createdAt: new Date(2026, 0, 1, 9, 0, seq), ...data });
      },
      delete: async ({ where }: any) => {
        const i = db.findIndex((r) => r.id === where.id);
        if (i >= 0) db.splice(i, 1);
      },
    },
  } as any;
}

const buy = (over: any = {}) => ({
  symbol: "2330", side: "BUY" as const, quantity: 1000, price: 100,
  fee: 143, tax: 0, date: new Date("2026-01-01"), ...over,
});

describe("holdings service", () => {
  it("新增後可列出", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const list = await listTransactions("u1", undefined, p);
    expect(list.length).toBe(1);
    expect(list[0].stockSymbol).toBe("2330");
  });
  it("跨使用者隔離", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    expect(await listTransactions("u2", undefined, p)).toEqual([]);
  });
  it("symbol 過濾", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", buy({ symbol: "2454" }), p);
    const list = await listTransactions("u1", "2454", p);
    expect(list.map((t) => t.stockSymbol)).toEqual(["2454"]);
  });
  it("超賣被拒", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await expect(
      addTransaction("u1", buy({ side: "SELL", quantity: 1500, date: new Date("2026-02-01") }), p),
    ).rejects.toThrow(OversellError);
    expect((await listTransactions("u1", undefined, p)).length).toBe(1);
  });
  it("可刪除自己的交易", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const [t] = await listTransactions("u1", undefined, p);
    expect(await deleteTransaction("u1", t.id, p)).toBe("deleted");
    expect((await listTransactions("u1", undefined, p)).length).toBe(0);
  });
  it("刪不到別人的交易", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const [t] = await listTransactions("u1", undefined, p);
    expect(await deleteTransaction("u2", t.id, p)).toBe("not_found");
  });
  it("刪買單導致後續賣單超賣:拒絕", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", buy({ side: "SELL", quantity: 1000, date: new Date("2026-02-01") }), p);
    const buyTxn = (await listTransactions("u1", undefined, p)).find((t) => t.side === "BUY")!;
    await expect(deleteTransaction("u1", buyTxn.id, p)).rejects.toThrow(OversellError);
  });
  it("getPositions 推導部位", async () => {
    const p = makeMock();
    await addTransaction("u1", buy({ fee: 0 }), p);
    const [pos] = await getPositions("u1", p);
    expect(pos).toMatchObject({ symbol: "2330", shares: 1000, avgCost: 100 });
  });
});
```

- [ ] **Step 2: 跑測試失敗**
- [ ] **Step 3: 實作**

```ts
// lib/holdings/service.ts
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  computePositions, validateNoOversell, type Position, type Side, type Txn,
} from "@/lib/holdings/positions";

type P = typeof defaultPrisma;

export class OversellError extends Error {
  constructor(symbol: string) {
    super(`持股不足:${symbol}`);
    this.name = "OversellError";
  }
}

export type NewTxnInput = {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  date: Date;
};

function toTxn(r: any): Txn {
  return {
    id: r.id, stockSymbol: r.stockSymbol, side: r.side as Side,
    quantity: r.quantity, price: r.price, fee: r.fee, tax: r.tax,
    date: new Date(r.date), createdAt: new Date(r.createdAt),
  };
}

export async function listTransactions(
  userId: string, symbol?: string, p: P = defaultPrisma,
): Promise<Txn[]> {
  const rows = await p.holdingTransaction.findMany({
    where: { userId, ...(symbol ? { stockSymbol: symbol } : {}) },
  });
  return rows.map(toTxn).sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export async function addTransaction(
  userId: string, input: NewTxnInput, p: P = defaultPrisma,
): Promise<void> {
  const existing = await listTransactions(userId, input.symbol, p);
  const candidate: Txn = {
    id: "candidate", stockSymbol: input.symbol, side: input.side,
    quantity: input.quantity, price: input.price, fee: input.fee, tax: input.tax,
    date: input.date, createdAt: new Date(8640000000000000), // 同日最後
  };
  const check = validateNoOversell([...existing, candidate]);
  if (!check.ok) throw new OversellError(check.symbol);
  await p.holdingTransaction.create({
    data: {
      userId, stockSymbol: input.symbol, side: input.side,
      quantity: input.quantity, price: input.price, fee: input.fee, tax: input.tax,
      date: input.date,
    },
  });
}

export async function deleteTransaction(
  userId: string, id: string, p: P = defaultPrisma,
): Promise<"deleted" | "not_found"> {
  const row = await p.holdingTransaction.findFirst({ where: { id, userId } });
  if (!row) return "not_found";
  const remaining = (await listTransactions(userId, row.stockSymbol, p)).filter((t) => t.id !== id);
  const check = validateNoOversell(remaining);
  if (!check.ok) throw new OversellError(check.symbol);
  await p.holdingTransaction.delete({ where: { id } });
  return "deleted";
}

export async function getPositions(userId: string, p: P = defaultPrisma): Promise<Position[]> {
  return computePositions(await listTransactions(userId, undefined, p));
}
```

- [ ] **Step 4: 跑測試通過**（注意:candidate 的 `createdAt` 用極大值確保同日重放時排最後——與「新交易輸入時間必然最晚」語意一致）
- [ ] **Step 5: Commit** `git commit -m "feat: holdings service(userId 隔離 CRUD + 超賣驗證)"`

---

### Task 6: API routes

**Files:**
- Create: `app/api/holdings/route.ts`
- Create: `app/api/holdings/transactions/route.ts`
- Create: `app/api/holdings/transactions/[id]/route.ts`

**Interfaces:**
- Consumes: Task 3/5 全部 + `getQuotes`（`@/lib/quotes/quoteService`）+ `estimateFee/estimateTax`（Task 1）+ `auth`（`@/auth`）
- Produces: 前端使用的 JSON 形狀
  - `GET /api/holdings` → `{ positions: [{ symbol, shares, totalCost, avgCost, realizedPnl, quote: Quote|null }], summary: Summary }`（僅 shares>0 的部位）
  - `GET/POST /api/holdings/transactions`、`DELETE /api/holdings/transactions/[id]`

- [ ] **Step 1: `app/api/holdings/route.ts`**

```ts
import { auth } from "@/auth";
import { getPositions } from "@/lib/holdings/service";
import { computeSummary } from "@/lib/holdings/positions";
import { getQuotes } from "@/lib/quotes/quoteService";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const all = await getPositions(session.user.id);
  const open = all.filter((p) => p.shares > 0);
  const quotes = await getQuotes(open.map((p) => p.symbol));
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const summary = computeSummary(all, bySymbol);
  const positions = open.map((p) => ({ ...p, quote: bySymbol.get(p.symbol) ?? null }));
  return Response.json({ positions, summary });
}
```

- [ ] **Step 2: `app/api/holdings/transactions/route.ts`**

```ts
import { auth } from "@/auth";
import { listTransactions, addTransaction, OversellError } from "@/lib/holdings/service";
import { estimateFee, estimateTax } from "@/lib/holdings/fees";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const symbol = new URL(req.url).searchParams.get("symbol") ?? undefined;
  const transactions = await listTransactions(session.user.id, symbol);
  return Response.json({ transactions });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "格式錯誤" }, { status: 400 });

  const { symbol, side, quantity, price, fee, tax, date } = body;
  if (typeof symbol !== "string" || !symbol) return Response.json({ error: "缺少股票代號" }, { status: 400 });
  if (side !== "BUY" && side !== "SELL") return Response.json({ error: "side 需為 BUY 或 SELL" }, { status: 400 });
  if (!Number.isInteger(quantity) || quantity <= 0) return Response.json({ error: "股數需為正整數" }, { status: 400 });
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return Response.json({ error: "價格需大於 0" }, { status: 400 });
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return Response.json({ error: "日期格式需為 YYYY-MM-DD" }, { status: 400 });
  }
  const feeOk = fee === undefined || (Number.isInteger(fee) && fee >= 0);
  const taxOk = tax === undefined || (Number.isInteger(tax) && tax >= 0);
  if (!feeOk || !taxOk) return Response.json({ error: "費用需為非負整數" }, { status: 400 });

  try {
    await addTransaction(session.user.id, {
      symbol, side, quantity, price,
      fee: fee ?? estimateFee(price, quantity),
      tax: tax ?? (side === "SELL" ? estimateTax(price, quantity) : 0),
      date: new Date(date),
    });
  } catch (e) {
    if (e instanceof OversellError) return Response.json({ error: "持股不足,無法賣出" }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: `app/api/holdings/transactions/[id]/route.ts`**（params 形狀仿 `app/api/watchlist/[symbol]/route.ts`——先讀該檔確認 Promise params 寫法）

```ts
import { auth } from "@/auth";
import { deleteTransaction, OversellError } from "@/lib/holdings/service";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const result = await deleteTransaction(session.user.id, id);
    if (result === "not_found") return Response.json({ error: "找不到交易" }, { status: 404 });
  } catch (e) {
    if (e instanceof OversellError) {
      return Response.json({ error: "刪除後會導致賣超,請先刪除較晚的賣出紀錄" }, { status: 400 });
    }
    throw e;
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: `pnpm exec tsc --noEmit`** → 無錯
- [ ] **Step 5: Commit** `git commit -m "feat: holdings API(部位總覽/交易 CRUD)"`

---

### Task 7: 前端 `/holdings`

**Files:**
- Create: `app/holdings/page.tsx`
- Create: `components/holdings/HoldingsView.tsx`
- Create: `components/holdings/SummaryBar.tsx`
- Create: `components/holdings/PositionCard.tsx`
- Create: `components/holdings/PositionRow.tsx`
- Create: `components/holdings/TransactionList.tsx`
- Create: `components/holdings/AddTransaction.tsx`

**Interfaces:**
- Consumes: `GET /api/holdings`、`GET/POST /api/holdings/transactions`、`DELETE /api/holdings/transactions/[id]`、`/api/stocks/search`、`fmtPrice/fmtSignedPct/fmtMoney/fmtSignedMoney/changeColorClass`、`estimateFee/estimateTax`（client 端預填）
- Produces: 頁面 `/holdings`

共用 client 型別（放 `components/holdings/types.ts`）：

```ts
import type { Quote } from "@/lib/quotes/types";
export type ApiPosition = {
  symbol: string; shares: number; totalCost: number;
  avgCost: number; realizedPnl: number; quote: Quote | null;
};
export type ApiSummary = {
  marketValue: number; totalCost: number; unrealizedPnl: number;
  returnPct: number; realizedPnl: number;
};
export type ApiTxn = {
  id: string; stockSymbol: string; side: "BUY" | "SELL"; quantity: number;
  price: number; fee: number; tax: number; date: string; createdAt: string;
};
```

- [ ] **Step 1: page + HoldingsView**（60s 輪詢仿 WatchlistView）

```tsx
// app/holdings/page.tsx
import AppShell from "@/components/layout/AppShell";
import HoldingsView from "@/components/holdings/HoldingsView";
export default function HoldingsPage() {
  return <AppShell title="持股損益"><HoldingsView /></AppShell>;
}
```

```tsx
// components/holdings/HoldingsView.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import type { ApiPosition, ApiSummary } from "@/components/holdings/types";
import SummaryBar from "@/components/holdings/SummaryBar";
import PositionCard from "@/components/holdings/PositionCard";
import PositionRow from "@/components/holdings/PositionRow";
import AddTransaction from "@/components/holdings/AddTransaction";

export default function HoldingsView() {
  const [positions, setPositions] = useState<ApiPosition[]>([]);
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/holdings");
    if (!res.ok) return;
    const json = await res.json();
    setPositions(json.positions ?? []);
    setSummary(json.summary ?? null);
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <AddTransaction onAdded={load} />
      {summary && <SummaryBar summary={summary} />}
      <div className="mb-2 text-right text-xs text-gray-500">更新於 {updatedAt}</div>

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {positions.map((p) => (
          <PositionCard key={p.symbol} position={p}
            expanded={expanded === p.symbol}
            onToggle={() => setExpanded(expanded === p.symbol ? null : p.symbol)}
            onChanged={load} />
        ))}
      </div>

      {/* 電腦:表格 */}
      <table className="hidden w-full md:table">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th>名稱</th><th className="text-right">股數</th><th className="text-right">均價</th>
            <th className="text-right">現價</th><th className="text-right">市值</th>
            <th className="text-right">未實現損益</th><th className="text-right">報酬率</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.symbol} position={p}
              expanded={expanded === p.symbol}
              onToggle={() => setExpanded(expanded === p.symbol ? null : p.symbol)}
              onChanged={load} />
          ))}
        </tbody>
      </table>

      {positions.length === 0 && (
        <p className="text-gray-400">還沒有持股紀錄,點上面「＋ 記一筆」開始追蹤損益。</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: SummaryBar**

```tsx
// components/holdings/SummaryBar.tsx
"use client";
import type { ApiSummary } from "@/components/holdings/types";
import { changeColorClass, fmtMoney, fmtSignedMoney, fmtSignedPct } from "@/lib/format";

export default function SummaryBar({ summary }: { summary: ApiSummary }) {
  const c = changeColorClass(summary.unrealizedPnl);
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-[var(--card)] p-4 md:grid-cols-4">
      <div>
        <div className="text-xs text-gray-400">總市值</div>
        <div className="text-lg font-bold">{fmtMoney(summary.marketValue)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">未實現損益</div>
        <div className={`text-lg font-bold ${c}`}>
          {fmtSignedMoney(summary.unrealizedPnl)}
          <span className="ml-1 text-sm">({fmtSignedPct(summary.returnPct)})</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">總成本</div>
        <div className="text-lg font-bold">{fmtMoney(summary.totalCost)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">已實現損益</div>
        <div className={`text-lg font-bold ${changeColorClass(summary.realizedPnl)}`}>
          {fmtSignedMoney(summary.realizedPnl)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: PositionCard / PositionRow / TransactionList**

```tsx
// components/holdings/TransactionList.tsx
"use client";
import { useEffect, useState } from "react";
import type { ApiTxn } from "@/components/holdings/types";
import { fmtPrice, fmtMoney } from "@/lib/format";

export default function TransactionList({ symbol, onChanged }: { symbol: string; onChanged: () => void }) {
  const [txns, setTxns] = useState<ApiTxn[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/holdings/transactions?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return;
    const json = await res.json();
    setTxns(json.transactions ?? []);
  }
  useEffect(() => { load(); }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    if (!confirm("確定刪除這筆交易?")) return;
    setError("");
    const res = await fetch(`/api/holdings/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "刪除失敗");
      return;
    }
    await load();
    onChanged();
  }

  return (
    <div className="mt-2 border-t border-white/10 pt-2 text-sm">
      {error && <p className="mb-1 text-down">{error}</p>}
      {txns.map((t) => (
        <div key={t.id} className="flex items-center justify-between py-1">
          <span className={t.side === "BUY" ? "text-up" : "text-down"}>
            {t.side === "BUY" ? "買" : "賣"}
          </span>
          <span className="text-gray-400">{t.date.slice(0, 10)}</span>
          <span>{t.quantity.toLocaleString()} 股</span>
          <span>@{fmtPrice(t.price)}</span>
          <span className="text-gray-400">費 {fmtMoney(t.fee + t.tax)}</span>
          <button onClick={() => remove(t.id)} className="text-gray-500" aria-label="刪除交易">✕</button>
        </div>
      ))}
      {txns.length === 0 && <p className="text-gray-500">無交易紀錄</p>}
    </div>
  );
}
```

```tsx
// components/holdings/PositionCard.tsx
"use client";
import Link from "next/link";
import type { ApiPosition } from "@/components/holdings/types";
import TransactionList from "@/components/holdings/TransactionList";
import { changeColorClass, fmtPrice, fmtSignedMoney, fmtSignedPct } from "@/lib/format";

export default function PositionCard({
  position: p, expanded, onToggle, onChanged,
}: {
  position: ApiPosition; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const unrealized = p.quote ? p.quote.price * p.shares - p.totalCost : null;
  const pct = unrealized !== null && p.totalCost > 0 ? (unrealized / p.totalCost) * 100 : null;
  const c = unrealized !== null ? changeColorClass(unrealized) : "text-gray-400";
  return (
    <div className="rounded-lg bg-[var(--card)] p-4">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold">{p.quote?.name ?? p.symbol}</div>
            <div className="text-xs text-gray-400">
              {p.symbol}・{p.shares.toLocaleString()} 股・均價 {fmtPrice(p.avgCost)}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-xl font-bold ${c}`}>
              {unrealized !== null ? fmtSignedMoney(unrealized) : "—"}
            </div>
            <div className={`text-sm ${c}`}>
              {pct !== null ? fmtSignedPct(pct) : "無報價"}
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <>
          <div className="mt-1 text-xs text-gray-400">
            現價 {p.quote ? fmtPrice(p.quote.price) : "—"}・
            <Link href={`/stock/${p.symbol}`} className="underline">看走勢</Link>
          </div>
          <TransactionList symbol={p.symbol} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}
```

```tsx
// components/holdings/PositionRow.tsx
"use client";
import Link from "next/link";
import type { ApiPosition } from "@/components/holdings/types";
import TransactionList from "@/components/holdings/TransactionList";
import { changeColorClass, fmtPrice, fmtMoney, fmtSignedMoney, fmtSignedPct } from "@/lib/format";

export default function PositionRow({
  position: p, expanded, onToggle, onChanged,
}: {
  position: ApiPosition; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const unrealized = p.quote ? p.quote.price * p.shares - p.totalCost : null;
  const pct = unrealized !== null && p.totalCost > 0 ? (unrealized / p.totalCost) * 100 : null;
  const c = unrealized !== null ? changeColorClass(unrealized) : "text-gray-400";
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-white/5 hover:bg-white/5">
        <td className="py-2">
          <Link href={`/stock/${p.symbol}`} onClick={(e) => e.stopPropagation()}>
            <span className="font-bold">{p.quote?.name ?? p.symbol}</span>
            <span className="ml-1 text-xs text-gray-400">{p.symbol}</span>
          </Link>
        </td>
        <td className="text-right">{p.shares.toLocaleString()}</td>
        <td className="text-right">{fmtPrice(p.avgCost)}</td>
        <td className="text-right">{p.quote ? fmtPrice(p.quote.price) : "—"}</td>
        <td className="text-right">{p.quote ? fmtMoney(p.quote.price * p.shares) : "—"}</td>
        <td className={`text-right ${c}`}>{unrealized !== null ? fmtSignedMoney(unrealized) : "無報價"}</td>
        <td className={`text-right ${c}`}>{pct !== null ? fmtSignedPct(pct) : "—"}</td>
      </tr>
      {expanded && (
        <tr><td colSpan={7}><TransactionList symbol={p.symbol} onChanged={onChanged} /></td></tr>
      )}
    </>
  );
}
```

- [ ] **Step 4: AddTransaction**（搜尋沿用 `/api/stocks/search`;fee/tax 以 `estimateFee/estimateTax` 預填,使用者改股數/價格/方向時若未手動改過費用則重算）

```tsx
// components/holdings/AddTransaction.tsx
"use client";
import { useState } from "react";
import { estimateFee, estimateTax } from "@/lib/holdings/fees";

type Side = "BUY" | "SELL";

export default function AddTransaction({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ symbol: string; name: string } | null>(null);
  const [side, setSide] = useState<Side>("BUY");
  const [quantity, setQuantity] = useState("1000");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(v: string) {
    setQ(v); setPicked(null);
    if (!v.trim()) { setResults([]); return; }
    const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(v)}`);
    const json = await res.json();
    setResults(json.results ?? []);
  }

  function refreshEstimates(nextSide: Side, nextQty: string, nextPrice: string) {
    if (feeTouched) return;
    const qty = parseInt(nextQty, 10);
    const p = parseFloat(nextPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(p) || p <= 0) { setFee(""); setTax(""); return; }
    setFee(String(estimateFee(p, qty)));
    setTax(nextSide === "SELL" ? String(estimateTax(p, qty)) : "0");
  }

  async function submit() {
    setError("");
    if (!picked) { setError("請先選擇股票"); return; }
    const qty = parseInt(quantity, 10);
    const prc = parseFloat(price);
    if (!Number.isInteger(qty) || qty <= 0) { setError("股數需為正整數"); return; }
    if (!Number.isFinite(prc) || prc <= 0) { setError("價格需大於 0"); return; }
    setBusy(true);
    const res = await fetch("/api/holdings/transactions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: picked.symbol, side, quantity: qty, price: prc, date,
        ...(fee !== "" ? { fee: parseInt(fee, 10) || 0 } : {}),
        ...(tax !== "" ? { tax: parseInt(tax, 10) || 0 } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "新增失敗");
      return;
    }
    setPrice(""); setFee(""); setTax(""); setFeeTouched(false); setError("");
    setOpen(false); onAdded();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-4 w-full rounded bg-[var(--card)] px-4 py-2 text-left text-gray-300">
        ＋ 記一筆買賣
      </button>
    );
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg bg-[var(--card)] p-4">
      <div className="relative">
        <input value={picked ? `${picked.name} ${picked.symbol}` : q}
          onChange={(e) => search(e.target.value)}
          placeholder="搜尋股票代號或名稱(如 2330 / 台積電)"
          className="w-full rounded bg-black/20 px-3 py-2 outline-none" />
        {!picked && results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full rounded bg-[var(--card)] shadow-lg">
            {results.map((r) => (
              <li key={r.symbol}>
                <button onClick={() => { setPicked(r); setResults([]); }}
                  className="flex w-full justify-between px-4 py-2 hover:bg-white/5">
                  <span>{r.name}</span><span className="text-gray-400">{r.symbol}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        {(["BUY", "SELL"] as const).map((s) => (
          <button key={s}
            onClick={() => { setSide(s); refreshEstimates(s, quantity, price); }}
            className={`flex-1 rounded py-2 ${side === s
              ? s === "BUY" ? "bg-up/20 text-up font-bold" : "bg-down/20 text-down font-bold"
              : "bg-black/20 text-gray-400"}`}>
            {s === "BUY" ? "買進" : "賣出"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm text-gray-400">
          股數
          <div className="mt-1 flex gap-1">
            <input inputMode="numeric" value={quantity}
              onChange={(e) => { setQuantity(e.target.value); refreshEstimates(side, e.target.value, price); }}
              className="w-full rounded bg-black/20 px-3 py-2 text-white outline-none" />
            <button onClick={() => { setQuantity("1000"); refreshEstimates(side, "1000", price); }}
              className="whitespace-nowrap rounded bg-black/20 px-2 text-xs text-gray-400">1張</button>
          </div>
        </label>
        <label className="text-sm text-gray-400">
          每股價格
          <input inputMode="decimal" value={price}
            onChange={(e) => { setPrice(e.target.value); refreshEstimates(side, quantity, e.target.value); }}
            className="mt-1 w-full rounded bg-black/20 px-3 py-2 text-white outline-none" />
        </label>
        <label className="text-sm text-gray-400">
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded bg-black/20 px-3 py-2 text-white outline-none" />
        </label>
        <label className="text-sm text-gray-400">
          手續費{side === "SELL" ? "+稅" : ""}(自動估算,可改)
          <div className="mt-1 flex gap-1">
            <input inputMode="numeric" value={fee}
              onChange={(e) => { setFee(e.target.value); setFeeTouched(true); }}
              placeholder="手續費"
              className="w-full rounded bg-black/20 px-3 py-2 text-white outline-none" />
            {side === "SELL" && (
              <input inputMode="numeric" value={tax}
                onChange={(e) => { setTax(e.target.value); setFeeTouched(true); }}
                placeholder="證交稅"
                className="w-full rounded bg-black/20 px-3 py-2 text-white outline-none" />
            )}
          </div>
        </label>
      </div>

      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy}
          className="flex-1 rounded bg-white/10 py-2 font-bold disabled:opacity-50">
          {busy ? "送出中…" : "送出"}
        </button>
        <button onClick={() => { setOpen(false); setError(""); }}
          className="rounded bg-black/20 px-4 text-gray-400">取消</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 驗證** `pnpm test -- --run` 全綠、`pnpm exec tsc --noEmit`、`pnpm build` 成功（`/holdings` 出現在 route 列表）
- [ ] **Step 6: Commit** `git commit -m "feat: /holdings 持股損益頁(總覽/部位/交易表單/明細)"`

---

### Task 8: 收尾

**Files:**
- Modify: `CLAUDE.md`（路線圖:持股損益標記已完成;加入 holdings 模組一行說明）

- [ ] **Step 1:** 全量驗證:`pnpm test -- --run` && `pnpm exec tsc --noEmit` && `pnpm build`
- [ ] **Step 2:** 更新 CLAUDE.md 路線圖與架構段落
- [ ] **Step 3:** Commit `git commit -m "docs: 路線圖更新(持股損益完成)"`
- [ ] **Step 4:** 部署:在 `~/devsecops-nazo` 跑 `bash kubernetes/tenants/tradex/build-update.sh`（initContainer 會自動 `prisma migrate deploy` 0003）
- [ ] **Step 5:** 線上驗證 `https://tradex.nazo.com.tw/holdings`
