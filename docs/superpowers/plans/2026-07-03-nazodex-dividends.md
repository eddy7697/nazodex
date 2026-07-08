# 持股股利／除權息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在持股損益的交易流水帳上支援現金股利（DIV_CASH）與配股（DIV_STOCK），部位顯示累計股利、配股稀釋均價。

**Architecture:** 零 migration——`side` 欄為 String，擴充值域即可。所有推導仍走 `computePositions` 重放；費用預設值抽成純函式 `resolveFees` 供 API route 使用。前端表單改四型別切換。

**Tech Stack:** Next.js App Router、Prisma、Vitest、Tailwind。

## Global Constraints

- 紅漲綠跌；顏色只用 `text-up`/`text-down` 或既有 Tailwind class，不寫死 hex。
- 金額顯示用 `lib/format.ts`（`fmtPrice`/`fmtMoney`/`fmtSignedMoney`/`fmtSignedPct`）。
- 每個 DB 查詢以 session userId 過濾。
- TDD：先寫失敗測試。測試指令 `pnpm test`（vitest run）。
- Spec：`docs/superpowers/specs/2026-07-03-nazodex-dividends-design.md`。

---

### Task 1: 費用估算——健保補充費與匯費常數 + resolveFees

**Files:**
- Modify: `lib/holdings/fees.ts`
- Test: `lib/holdings/__tests__/fees.test.ts`

**Interfaces:**
- Produces: `estimateNhi(amount: number): number`、`DIV_TRANSFER_FEE = 10`、`resolveFees(side: Side, quantity: number, price: number, fee?: number, tax?: number): { fee: number; tax: number }`（Side 自 Task 2 擴充後含 DIV_*；本 task 先以字串 union 寫，Task 2 完成後型別自然吻合——實作時直接 `import type { Side } from "@/lib/holdings/positions"`，因 Task 2 先做或同時做皆可，**建議先做 Task 2**）。

**注意：實際執行順序 Task 2 → Task 1**（resolveFees 需要擴充後的 `Side` 型別）。

- [ ] **Step 1: 追加失敗測試**（`fees.test.ts` 檔尾）

```ts
describe("estimateNhi", () => {
  it("未達 2 萬不課", () => {
    expect(estimateNhi(19999)).toBe(0);
  });
  it("2 萬(含)以上課 2.11% 四捨五入", () => {
    expect(estimateNhi(20000)).toBe(422);
    // 35000 * 0.0211 = 738.5 → 739 (Math.round half-up)
    expect(estimateNhi(35000)).toBe(739);
  });
});

describe("resolveFees", () => {
  it("BUY:缺省補估算手續費,稅 0", () => {
    expect(resolveFees("BUY", 1000, 600)).toEqual({ fee: 855, tax: 0 });
  });
  it("SELL:缺省補手續費+證交稅", () => {
    expect(resolveFees("SELL", 1000, 600)).toEqual({ fee: 855, tax: 1800 });
  });
  it("使用者覆寫優先", () => {
    expect(resolveFees("BUY", 1000, 600, 20, 5)).toEqual({ fee: 20, tax: 5 });
  });
  it("DIV_CASH:預設匯費 10、達門檻補充費", () => {
    // 10000 股 * 2.5 元 = 25000 ≥ 20000 → nhi = round(25000*0.0211) = 528
    expect(resolveFees("DIV_CASH", 10000, 2.5)).toEqual({ fee: 10, tax: 528 });
    // 1000 股 * 2.5 = 2500 < 20000 → 0
    expect(resolveFees("DIV_CASH", 1000, 2.5)).toEqual({ fee: 10, tax: 0 });
  });
  it("DIV_STOCK:一律歸零(覆寫也無效)", () => {
    expect(resolveFees("DIV_STOCK", 1000, 0, 99, 99)).toEqual({ fee: 0, tax: 0 });
  });
});
```

並在檔頭 import 加入 `estimateNhi, resolveFees`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- fees`
Expected: FAIL（estimateNhi / resolveFees 未定義）

- [ ] **Step 3: 實作**（`fees.ts` 追加）

```ts
import type { Side } from "@/lib/holdings/positions";

// 二代健保補充保費:單筆股利 ≥ 2 萬課 2.11%
const NHI_RATE = 0.0211;
const NHI_THRESHOLD = 20000;
// 現金股利匯費常見預設(可在表單覆寫)
export const DIV_TRANSFER_FEE = 10;

export function estimateNhi(amount: number): number {
  return amount >= NHI_THRESHOLD ? Math.round(amount * NHI_RATE) : 0;
}

// 缺省費用補值;DIV_STOCK 無現金流,費稅一律歸零(防呆優先於報錯)。
export function resolveFees(
  side: Side, quantity: number, price: number, fee?: number, tax?: number,
): { fee: number; tax: number } {
  if (side === "DIV_STOCK") return { fee: 0, tax: 0 };
  const defaultFee = side === "DIV_CASH" ? DIV_TRANSFER_FEE : estimateFee(price, quantity);
  const defaultTax =
    side === "SELL" ? estimateTax(price, quantity)
    : side === "DIV_CASH" ? estimateNhi(price * quantity)
    : 0;
  return { fee: fee ?? defaultFee, tax: tax ?? defaultTax };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- fees`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/holdings/fees.ts lib/holdings/__tests__/fees.test.ts
git commit -m "feat: 股利費用估算(健保補充費/匯費)與 resolveFees 缺省補值"
```

---

### Task 2: positions 純函式——股利型別與重放邏輯

**Files:**
- Modify: `lib/holdings/positions.ts`
- Test: `lib/holdings/__tests__/positions.test.ts`

**Interfaces:**
- Produces: `Side = "BUY" | "SELL" | "DIV_CASH" | "DIV_STOCK"`；`Position` 加 `dividendIncome: number`；`Summary` 加 `dividendIncome: number`。`Txn` 結構不變。

- [ ] **Step 1: 追加失敗測試**（`positions.test.ts`）

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- positions`
Expected: 新測試 FAIL；且既有 `toEqual` 精確比對（單筆買進、summary 等）會因缺 `dividendIncome` 欄位一併 FAIL——**這些既有斷言要補 `dividendIncome: 0`**（單筆買進的 expected object、computeSummary 的 expected object）。

- [ ] **Step 3: 實作**（`positions.ts` 修改）

```ts
export type Side = "BUY" | "SELL" | "DIV_CASH" | "DIV_STOCK";
```

`Position` 與 `Summary` 各加 `dividendIncome: number;`（註解：累計實收現金股利，扣匯費/補充費）。

`computePositions` 迴圈改為：

```ts
const pos = bySymbol.get(t.stockSymbol) ?? { shares: 0, totalCost: 0, realizedPnl: 0, dividendIncome: 0 };
if (t.side === "BUY") {
  pos.shares += t.quantity;
  pos.totalCost += t.quantity * t.price + t.fee;
} else if (t.side === "SELL") {
  const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
  pos.realizedPnl += t.quantity * t.price - t.fee - t.tax - avgCost * t.quantity;
  pos.shares -= t.quantity;
  pos.totalCost -= avgCost * t.quantity;
} else if (t.side === "DIV_CASH") {
  pos.dividendIncome += t.quantity * t.price - t.fee - t.tax;
} else {
  // DIV_STOCK 配股:股數增、成本不變 → 均價自然稀釋
  pos.shares += t.quantity;
}
```

輸出 map 加 `dividendIncome: p.dividendIncome`。

`validateNoOversell` 迴圈改為：

```ts
if (t.side === "DIV_CASH") continue;
const cur = shares.get(t.stockSymbol) ?? 0;
const next = t.side === "SELL" ? cur - t.quantity : cur + t.quantity; // BUY 與 DIV_STOCK 皆加股
```

`computeSummary`：迴圈內 `realizedPnl += p.realizedPnl;` 之後加 `dividendIncome += p.dividendIncome;`（在 `if (p.shares <= 0) continue;` 之前），初始化 `let dividendIncome = 0;`，回傳物件加 `dividendIncome`。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- positions`
Expected: PASS（含更新後的既有斷言）

- [ ] **Step 5: Commit**

```bash
git add lib/holdings/positions.ts lib/holdings/__tests__/positions.test.ts
git commit -m "feat: 部位重放支援現金股利/配股(dividendIncome、配股稀釋均價)"
```

---

### Task 3: service 測試補強 + API route 四型別

**Files:**
- Modify: `app/api/holdings/transactions/route.ts`
- Test: `lib/holdings/__tests__/service.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveFees`、Task 2 `Side`。
- Produces: `POST /api/holdings/transactions` 接受 `side ∈ {BUY, SELL, DIV_CASH, DIV_STOCK}`；DIV_STOCK 可不帶 price（強制 0）。service 本身**零程式碼變更**（`NewTxnInput.side: Side` 隨型別擴充）。

- [ ] **Step 1: 追加 service 測試**（`service.test.ts` 檔尾；驗證新型別走既有 CRUD 與重放）

```ts
describe("股利交易", () => {
  it("配股計入持股,刪配股導致超賣被拒", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", {
      symbol: "2330", side: "DIV_STOCK", quantity: 100, price: 0,
      fee: 0, tax: 0, date: new Date("2026-02-01"),
    }, p);
    await addTransaction("u1", {
      symbol: "2330", side: "SELL", quantity: 1100, price: 120,
      fee: 0, tax: 0, date: new Date("2026-03-01"),
    }, p);
    const divId = p._db.find((r: any) => r.side === "DIV_STOCK").id;
    await expect(deleteTransaction("u1", divId, p)).rejects.toThrow(OversellError);
  });
  it("現金股利反映在 getPositions 的 dividendIncome", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", {
      symbol: "2330", side: "DIV_CASH", quantity: 1000, price: 2.5,
      fee: 10, tax: 0, date: new Date("2026-02-01"),
    }, p);
    const [pos] = await getPositions("u1", p);
    expect(pos.dividendIncome).toBe(2490);
    expect(pos.shares).toBe(1000);
  });
});
```

- [ ] **Step 2: 跑測試確認通過**（service 無需改碼，此為回歸保障）

Run: `pnpm test -- service`
Expected: PASS（若 FAIL 表示型別/邏輯有漏，先修復）

- [ ] **Step 3: 改 route**（`app/api/holdings/transactions/route.ts` 的 POST）

import 改為：

```ts
import { resolveFees } from "@/lib/holdings/fees";
import type { Side } from "@/lib/holdings/positions";
```

（移除不再使用的 `estimateFee, estimateTax` import。）

驗證區塊改為：

```ts
const SIDES: Side[] = ["BUY", "SELL", "DIV_CASH", "DIV_STOCK"];
if (!SIDES.includes(side)) return Response.json({ error: "side 不合法" }, { status: 400 });
if (!Number.isInteger(quantity) || quantity <= 0) return Response.json({ error: "股數需為正整數" }, { status: 400 });
// DIV_STOCK 無現金流,不要求 price;其餘(含每股股利)需 > 0
if (side !== "DIV_STOCK" && (typeof price !== "number" || !Number.isFinite(price) || price <= 0)) {
  return Response.json({ error: "價格需大於 0" }, { status: 400 });
}
```

（symbol／date／fee／tax 驗證維持原樣。）

寫入區塊改為：

```ts
const finalPrice = side === "DIV_STOCK" ? 0 : price;
try {
  await addTransaction(session.user.id, {
    symbol, side, quantity, price: finalPrice,
    ...resolveFees(side, quantity, finalPrice, fee, tax),
    date: new Date(date),
  });
}
```

- [ ] **Step 4: 全套測試 + tsc**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: 全 PASS、無型別錯誤

- [ ] **Step 5: Commit**

```bash
git add app/api/holdings/transactions/route.ts lib/holdings/__tests__/service.test.ts
git commit -m "feat: 交易 API 接受股利型別(DIV_CASH/DIV_STOCK),費用缺省走 resolveFees"
```

---

### Task 4: 前端型別 + AddTransaction 四型別表單

**Files:**
- Modify: `components/holdings/types.ts`
- Modify: `components/holdings/AddTransaction.tsx`
- Modify: `components/holdings/HoldingsView.tsx`（傳入 sharesBySymbol）

**Interfaces:**
- Consumes: Task 1 `DIV_TRANSFER_FEE, estimateNhi`；Task 3 API 行為。
- Produces: `AddTransaction` props 變為 `{ onAdded: () => void; sharesBySymbol: Record<string, number> }`；`ApiPosition`/`ApiSummary` 加 `dividendIncome: number`、`ApiTxn.side` 擴為四值 union（Task 5 依賴）。

- [ ] **Step 1: types.ts**

`ApiPosition` 與 `ApiSummary` 各加 `dividendIncome: number;`；`ApiTxn.side` 改為 `"BUY" | "SELL" | "DIV_CASH" | "DIV_STOCK"`。

- [ ] **Step 2: AddTransaction 改寫**

要點（保持既有結構與樣式，最小改動）：

```tsx
import { estimateFee, estimateTax, estimateNhi, DIV_TRANSFER_FEE } from "@/lib/holdings/fees";
import type { Side } from "@/lib/holdings/positions";

const SIDE_OPTS: { value: Side; label: string; cls: string }[] = [
  { value: "BUY", label: "買進", cls: "text-up" },
  { value: "SELL", label: "賣出", cls: "text-down" },
  { value: "DIV_CASH", label: "現金股利", cls: "text-amber-400" },
  { value: "DIV_STOCK", label: "配股", cls: "text-amber-400" },
];
```

props：`{ onAdded, sharesBySymbol }: { onAdded: () => void; sharesBySymbol: Record<string, number> }`。

`refreshEstimates(nextSide, nextQty, nextPrice)` 擴充：

```tsx
function refreshEstimates(nextSide: Side, nextQty: string, nextPrice: string) {
  if (feeTouched) return;
  if (nextSide === "DIV_STOCK") { setFee("0"); setTax("0"); return; }
  const qty = parseInt(nextQty, 10);
  const p = parseFloat(nextPrice);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(p) || p <= 0) { setFee(""); setTax(""); return; }
  if (nextSide === "DIV_CASH") {
    setFee(String(DIV_TRANSFER_FEE));
    setTax(String(estimateNhi(p * qty)));
    return;
  }
  setFee(String(estimateFee(p, qty)));
  setTax(nextSide === "SELL" ? String(estimateTax(p, qty)) : "0");
}
```

型別切換列改用 `SIDE_OPTS`（4 顆按鈕，選中者 `bg-white/10 font-bold ${o.cls}`），onClick 時若切到 `DIV_CASH` 且已選股、該檔有持股，順帶預填股數：

```tsx
onClick={() => {
  setSide(o.value);
  let nextQty = quantity;
  if (o.value === "DIV_CASH" && picked && sharesBySymbol[picked.symbol] > 0) {
    nextQty = String(sharesBySymbol[picked.symbol]);
    setQuantity(nextQty);
  }
  refreshEstimates(o.value, nextQty, price);
}}
```

選股 `setPicked(r)` 時同樣：若 `side === "DIV_CASH"` 且 `sharesBySymbol[r.symbol] > 0` 就 `setQuantity(String(sharesBySymbol[r.symbol]))` 並 refreshEstimates。

欄位條件顯示：
- 價格欄 label：`side === "DIV_CASH" ? "每股股利" : "每股價格"`；`side === "DIV_STOCK"` 時整個價格欄不渲染。
- 費用欄：`side === "DIV_STOCK"` 時不渲染；`side === "DIV_CASH"` 時 label 為「匯費+健保補充費(可改)」，兩個 input placeholder 分別「匯費」「補充費」（tax input 在 DIV_CASH 與 SELL 時都渲染：條件改為 `(side === "SELL" || side === "DIV_CASH")`）。
- 股數欄的「1張」快速鍵維持。

`submit()` 驗證：price 檢查改為 `if (side !== "DIV_STOCK" && (!Number.isFinite(prc) || prc <= 0)) { setError(side === "DIV_CASH" ? "每股股利需大於 0" : "價格需大於 0"); return; }`；body 的 price 在 DIV_STOCK 時送 0（`price: side === "DIV_STOCK" ? 0 : prc`）。

折疊按鈕文字改為「＋ 記一筆買賣／股利」。

- [ ] **Step 3: HoldingsView 傳 props**

```tsx
<AddTransaction onAdded={load}
  sharesBySymbol={Object.fromEntries(positions.filter((p) => p.shares > 0).map((p) => [p.symbol, p.shares]))} />
```

- [ ] **Step 4: 驗證**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/holdings/types.ts components/holdings/AddTransaction.tsx components/holdings/HoldingsView.tsx
git commit -m "feat: 記帳表單支援現金股利/配股(持股預填、匯費/補充費自動估)"
```

---

### Task 5: 明細、總覽與部位顯示股利

**Files:**
- Modify: `components/holdings/TransactionList.tsx`
- Modify: `components/holdings/SummaryBar.tsx`
- Modify: `components/holdings/PositionCard.tsx`
- Modify: `components/holdings/PositionRow.tsx`

**Interfaces:**
- Consumes: Task 4 的 `ApiTxn.side` 四值、`ApiPosition.dividendIncome`、`ApiSummary.dividendIncome`。

- [ ] **Step 1: TransactionList 股利列**

```tsx
const SIDE_LABEL: Record<ApiTxn["side"], string> = { BUY: "買", SELL: "賣", DIV_CASH: "息", DIV_STOCK: "配" };
const SIDE_CLASS: Record<ApiTxn["side"], string> = {
  BUY: "text-up", SELL: "text-down", DIV_CASH: "text-amber-400", DIV_STOCK: "text-amber-400",
};
```

列內：

```tsx
<span className={SIDE_CLASS[t.side]}>{SIDE_LABEL[t.side]}</span>
<span className="text-gray-400">{t.date.slice(0, 10)}</span>
<span>{t.quantity.toLocaleString()} 股</span>
<span>{t.side === "DIV_STOCK" ? "無償" : `@${fmtPrice(t.price)}`}</span>
<span className="text-gray-400">
  {t.side === "DIV_CASH"
    ? `實收 ${fmtMoney(t.quantity * t.price - t.fee - t.tax)}`
    : `費 ${fmtMoney(t.fee + t.tax)}`}
</span>
```

（刪除鍵與其餘結構不動。）

- [ ] **Step 2: SummaryBar 股利收入**

```tsx
const showDiv = summary.dividendIncome > 0;
```

外層 grid class 改為：

```tsx
`mb-4 grid grid-cols-2 gap-3 rounded-lg bg-[var(--card)] p-4 ${showDiv ? "md:grid-cols-5" : "md:grid-cols-4"}`
```

已實現損益格之後加：

```tsx
{showDiv && (
  <div>
    <div className="text-xs text-gray-400">股利收入</div>
    <div className="text-lg font-bold text-amber-400">{fmtMoney(summary.dividendIncome)}</div>
  </div>
)}
```

（import 已有 `fmtMoney`。）

- [ ] **Step 3: PositionCard / PositionRow 累計股利**

PositionCard 展開區的「現價…看走勢」行後追加：

```tsx
{p.dividendIncome > 0 && (
  <div className="mt-1 text-xs text-gray-400">累計股利 {fmtMoney(p.dividendIncome)}</div>
)}
```

（import 加 `fmtMoney`。）

PositionRow 展開列 `<td colSpan={7}>` 內、`TransactionList` 之前追加：

```tsx
{p.dividendIncome > 0 && (
  <div className="mt-2 text-xs text-gray-400">累計股利 {fmtMoney(p.dividendIncome)}</div>
)}
```

- [ ] **Step 4: 全面驗證**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: 測試全 PASS、tsc 無錯、build 成功

- [ ] **Step 5: Commit**

```bash
git add components/holdings/TransactionList.tsx components/holdings/SummaryBar.tsx components/holdings/PositionCard.tsx components/holdings/PositionRow.tsx
git commit -m "feat: 持股頁顯示股利(明細列/總覽股利收入/部位累計股利)"
```

---

### Task 6: 文件更新

**Files:**
- Modify: `CLAUDE.md`（持股損益段落補股利說明、路線圖劃掉已完成項）

- [ ] **Step 1:** 持股損益段落補一句：交易型別含 `DIV_CASH`（現金股利，累計 `dividendIncome`）與 `DIV_STOCK`（配股稀釋均價），費用缺省補值集中在 `fees.resolveFees`（匯費 10、健保補充費 2.11% 門檻 2 萬）。路線圖第 1 項改為「股利/除權息已上線(2026-07-03)，剩報表圖表」。
- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 納入股利/除權息"
```
