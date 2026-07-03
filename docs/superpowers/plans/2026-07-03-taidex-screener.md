# 條件選股(Screener)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/screener` 頁:內建三個 preset 選股策略 + 可自訂條件,對 TWSE 免費快照(價量+估值)做前端即時過濾。

**Architecture:** 後端 `getScreenerSnapshot()` 拉 STOCK_DAY_ALL + BWIBBU_ALL 兩個 TWSE OpenAPI、以 Code join 成 `ScreenerRow[]`(10min memoize,無 DB);GET `/api/screener` 下發整包快照;前端一次載入後在瀏覽器過濾/排序。純函式 engine(`applyConditions`/`sortRows`/`PRESETS`)集中選股邏輯。

**Tech Stack:** Next.js App Router、TypeScript strict、Vitest、Tailwind(現有專案慣例)。

## Global Constraints

- 紅漲綠跌:顏色一律用 `changeColorClass`/`text-up`/`text-down`,元件不得寫死 hex。
- 價格/百分比顯示用 `lib/format.ts`(`fmtPrice`/`fmtPct`/`fmtSignedPct`)。
- fetch 上游一律 8s AbortController(比照 `lib/ingest/twseOpenApi.ts`)。
- 所有 API route 先 `auth()` 驗 session(比照 `app/api/market/route.ts`)。
- 測試指令:`pnpm test`(vitest,jsdom);型別:`pnpm exec tsc --noEmit`。
- TDD:每個 task 先寫失敗測試。

---

### Task 1: BWIBBU 估值 parser + fetcher

**Files:**
- Create: `lib/screener/bwibbu.ts`
- Test: `lib/screener/__tests__/bwibbu.test.ts`

**Interfaces:**
- Produces: `type ValuationRow = { symbol: string; peRatio: number | null; dividendYield: number | null; pbRatio: number | null }`;`parseBwibbu(json: unknown): ValuationRow[]`;`fetchBwibbu(fetchImpl?: typeof fetch): Promise<ValuationRow[]>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/screener/__tests__/bwibbu.test.ts
import { describe, it, expect } from "vitest";
import { parseBwibbu } from "@/lib/screener/bwibbu";

const sample = [
  { Date: "1150702", Code: "1101", Name: "台泥", PEratio: "", DividendYield: "3.46", PBratio: "0.74" },
  { Date: "1150702", Code: "2330", Name: "台積電", PEratio: "25.51", DividendYield: "1.55", PBratio: "7.53" },
  { Date: "1150702", Code: "", Name: "", PEratio: "-", DividendYield: "-", PBratio: "-" }, // 無代號應略過
];

describe("parseBwibbu", () => {
  it("解析估值列,空字串/'-' 轉 null,無代號略過", () => {
    const rows = parseBwibbu(sample);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ symbol: "1101", peRatio: null, dividendYield: 3.46, pbRatio: 0.74 });
    expect(rows[1]).toEqual({ symbol: "2330", peRatio: 25.51, dividendYield: 1.55, pbRatio: 7.53 });
  });
  it("非陣列輸入回空陣列", () => {
    expect(parseBwibbu({ oops: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/screener/__tests__/bwibbu.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/screener/bwibbu.ts
type Raw = Record<string, string>;
export type ValuationRow = {
  symbol: string;
  peRatio: number | null;
  dividendYield: number | null;
  pbRatio: number | null;
};

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseBwibbu(json: unknown): ValuationRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: ValuationRow[] = [];
  for (const r of arr) {
    const symbol = (r.Code ?? "").trim();
    if (!symbol) continue;
    out.push({
      symbol,
      peRatio: num(r.PEratio),
      dividendYield: num(r.DividendYield),
      pbRatio: num(r.PBratio),
    });
  }
  return out;
}

export async function fetchBwibbu(fetchImpl: typeof fetch = fetch): Promise<ValuationRow[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TWSE OpenAPI BWIBBU_ALL failed: ${res.status}`);
    return parseBwibbu(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/screener/__tests__/bwibbu.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/screener/bwibbu.ts lib/screener/__tests__/bwibbu.test.ts
git commit -m "feat: BWIBBU_ALL 估值 parser+fetcher(本益比/殖利率/淨值比)"
```

---

### Task 2: twseOpenApi DailyRow 增加 change/date 欄位

**Files:**
- Modify: `lib/ingest/twseOpenApi.ts`
- Test: `lib/ingest/__tests__/twseOpenApi.test.ts`(增測)

**Interfaces:**
- Produces: `DailyRow` 增加 `change: number | null`(漲跌價差,STOCK_DAY_ALL `Change` 欄)與 `date: string | null`(ISO,民國 `Date` 欄轉換)。既有欄位與 `scripts/ingest-daily.ts` 不受影響。

- [ ] **Step 1: Write the failing test**(在既有 describe 後追加)

```ts
// lib/ingest/__tests__/twseOpenApi.test.ts — 追加到檔尾
const sampleWithChange = [
  {
    Date: "1150702", Code: "2330", Name: "台積電",
    OpeningPrice: "1080.00", HighestPrice: "1090.00",
    LowestPrice: "1075.00", ClosingPrice: "1085.00", TradeVolume: "21000000",
    Change: "-15.0000",
  },
];

describe("parseTwseDaily change/date", () => {
  it("解析漲跌價差與 ISO 日期", () => {
    const rows = parseTwseDaily(sampleWithChange);
    expect(rows[0].change).toBe(-15);
    expect(rows[0].date).toBe("2026-07-02");
  });
  it("缺 Change/Date 時為 null(舊 fixture 無此欄)", () => {
    const rows = parseTwseDaily(sample);
    expect(rows[0].change).toBeNull();
    expect(rows[0].date).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/ingest/__tests__/twseOpenApi.test.ts`
Expected: FAIL(`change` undefined ≠ null / 型別錯誤)

- [ ] **Step 3: Write minimal implementation**

`lib/ingest/twseOpenApi.ts` 修改:

```ts
export type DailyRow = {
  symbol: string; name: string;
  open: number; high: number; low: number; close: number; volume: number;
  change: number | null;      // 漲跌價差(帶正負);缺值 null
  date: string | null;        // ISO 日期(民國轉換);缺值 null
};

// 民國 "1150702" → "2026-07-02"
function rocToIso(d: string | undefined): string | null {
  const m = d?.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}
```

`parseTwseDaily` 的 `out.push({...})` 增加兩行:

```ts
      change: num(r.Change),
      date: rocToIso(r.Date),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/ingest/__tests__/twseOpenApi.test.ts`
Expected: PASS(原 1 test + 新 2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/twseOpenApi.ts lib/ingest/__tests__/twseOpenApi.test.ts
git commit -m "feat: STOCK_DAY_ALL parser 增加漲跌價差與資料日期欄位"
```

---

### Task 3: 選股 engine(types + applyConditions + sortRows + PRESETS + CONDITION_DEFS)

**Files:**
- Create: `lib/screener/types.ts`
- Create: `lib/screener/engine.ts`
- Test: `lib/screener/__tests__/engine.test.ts`

**Interfaces:**
- Produces(types.ts):

```ts
export type ScreenerRow = {
  symbol: string;
  name: string;
  close: number;
  changePct: number | null;
  volumeLots: number;                // 成交張數(股/1000 取整)
  peRatio: number | null;
  dividendYield: number | null;
  pbRatio: number | null;
};
export type NumericField = "close" | "changePct" | "volumeLots" | "peRatio" | "dividendYield" | "pbRatio";
export type Condition = { field: NumericField; op: "gte" | "lte"; value: number };
export type Preset = {
  key: string;
  label: string;
  conditions: Condition[];
  sort: { field: NumericField; dir: "asc" | "desc" };
};
export type ScreenerSnapshot = { date: string | null; rows: ScreenerRow[] };
```

- Produces(engine.ts):`applyConditions(rows, conditions): ScreenerRow[]`(AND;欄位 null 即不符合)、`sortRows(rows, field, dir): ScreenerRow[]`(回新陣列,null 排最後)、`PRESETS: Preset[]`(高殖利率/便宜好股/今日強勢)、`CONDITION_DEFS`(UI 條件面板的固定六列定義)。

- [ ] **Step 1: Write the failing test**

```ts
// lib/screener/__tests__/engine.test.ts
import { describe, it, expect } from "vitest";
import { applyConditions, sortRows, PRESETS, CONDITION_DEFS } from "@/lib/screener/engine";
import type { ScreenerRow } from "@/lib/screener/types";

function row(partial: Partial<ScreenerRow>): ScreenerRow {
  return {
    symbol: "0000", name: "測試", close: 100, changePct: 0, volumeLots: 1000,
    peRatio: 15, dividendYield: 4, pbRatio: 1.5, ...partial,
  };
}

describe("applyConditions", () => {
  const rows = [
    row({ symbol: "1101", dividendYield: 6, peRatio: 10 }),
    row({ symbol: "2330", dividendYield: 1.5, peRatio: 25 }),
    row({ symbol: "0050", dividendYield: null, peRatio: null }), // ETF 無估值
  ];
  it("gte/lte AND 串接", () => {
    const out = applyConditions(rows, [
      { field: "dividendYield", op: "gte", value: 5 },
      { field: "peRatio", op: "lte", value: 20 },
    ]);
    expect(out.map((r) => r.symbol)).toEqual(["1101"]);
  });
  it("欄位 null 的列不符合該條件", () => {
    const out = applyConditions(rows, [{ field: "peRatio", op: "lte", value: 30 }]);
    expect(out.map((r) => r.symbol)).toEqual(["1101", "2330"]);
  });
  it("無條件回傳全部", () => {
    expect(applyConditions(rows, [])).toHaveLength(3);
  });
});

describe("sortRows", () => {
  const rows = [
    row({ symbol: "A", dividendYield: 3 }),
    row({ symbol: "B", dividendYield: null }),
    row({ symbol: "C", dividendYield: 7 }),
  ];
  it("desc 且 null 排最後,不改動原陣列", () => {
    const out = sortRows(rows, "dividendYield", "desc");
    expect(out.map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });
  it("asc 且 null 仍排最後", () => {
    const out = sortRows(rows, "dividendYield", "asc");
    expect(out.map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });
});

describe("PRESETS / CONDITION_DEFS", () => {
  it("三個 preset,條件欄位皆在 CONDITION_DEFS 內且方向一致", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(["dividend", "value", "momentum"]);
    for (const p of PRESETS) {
      for (const c of p.conditions) {
        const def = CONDITION_DEFS.find((d) => d.field === c.field);
        expect(def, `${p.key}:${c.field}`).toBeDefined();
        expect(def!.op).toBe(c.op);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/screener/__tests__/engine.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: Write minimal implementation**

`lib/screener/types.ts`:內容即上方 Interfaces 區塊的 types 全文。

```ts
// lib/screener/engine.ts
import type { Condition, NumericField, Preset, ScreenerRow } from "@/lib/screener/types";

export function applyConditions(rows: ScreenerRow[], conditions: Condition[]): ScreenerRow[] {
  return rows.filter((r) =>
    conditions.every((c) => {
      const v = r[c.field];
      if (v == null) return false;
      return c.op === "gte" ? v >= c.value : v <= c.value;
    }),
  );
}

export function sortRows(rows: ScreenerRow[], field: NumericField, dir: "asc" | "desc"): ScreenerRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[field]; const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // null 一律排最後
    if (bv == null) return -1;
    return sign * (av - bv);
  });
}

export const PRESETS: Preset[] = [
  {
    key: "dividend", label: "高殖利率",
    conditions: [
      { field: "dividendYield", op: "gte", value: 5 },
      { field: "peRatio", op: "lte", value: 20 },
      { field: "volumeLots", op: "gte", value: 500 },
    ],
    sort: { field: "dividendYield", dir: "desc" },
  },
  {
    key: "value", label: "便宜好股",
    conditions: [
      { field: "peRatio", op: "lte", value: 12 },
      { field: "pbRatio", op: "lte", value: 1.5 },
      { field: "dividendYield", op: "gte", value: 3 },
    ],
    sort: { field: "peRatio", dir: "asc" },
  },
  {
    key: "momentum", label: "今日強勢",
    conditions: [
      { field: "changePct", op: "gte", value: 3 },
      { field: "volumeLots", op: "gte", value: 1000 },
    ],
    sort: { field: "changePct", dir: "desc" },
  },
];

// 條件面板的固定六列(方向固定,新手不用想 ≥/≤)
export const CONDITION_DEFS: {
  field: NumericField; op: "gte" | "lte"; label: string; unit: string; defaultValue: number;
}[] = [
  { field: "dividendYield", op: "gte", label: "殖利率 ≥", unit: "%", defaultValue: 5 },
  { field: "peRatio", op: "lte", label: "本益比 ≤", unit: "倍", defaultValue: 15 },
  { field: "pbRatio", op: "lte", label: "淨值比 ≤", unit: "倍", defaultValue: 1.5 },
  { field: "changePct", op: "gte", label: "今日漲幅 ≥", unit: "%", defaultValue: 3 },
  { field: "volumeLots", op: "gte", label: "成交量 ≥", unit: "張", defaultValue: 500 },
  { field: "close", op: "lte", label: "股價 ≤", unit: "元", defaultValue: 100 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/screener/__tests__/engine.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/screener/types.ts lib/screener/engine.ts lib/screener/__tests__/engine.test.ts
git commit -m "feat: 選股 engine(條件過濾/排序/preset 策略/條件面板定義)"
```

---

### Task 4: snapshot service(join + memoize + 容錯)

**Files:**
- Create: `lib/screener/service.ts`
- Test: `lib/screener/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `DailyRow`(Task 2)、`ValuationRow`(Task 1)、`ScreenerSnapshot`(Task 3)、`memoize`(`lib/quotes/cache.ts`)。
- Produces: `buildSnapshot(daily: DailyRow[], valuation: ValuationRow[]): ScreenerSnapshot`(純函式)、`getScreenerSnapshot(deps?: SnapshotDeps): Promise<ScreenerSnapshot>`,`type SnapshotDeps = { daily?: () => Promise<DailyRow[]>; valuation?: () => Promise<ValuationRow[]> }`。

- [ ] **Step 1: Write the failing test**

```ts
// lib/screener/__tests__/service.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot, getScreenerSnapshot } from "@/lib/screener/service";
import type { DailyRow } from "@/lib/ingest/twseOpenApi";
import type { ValuationRow } from "@/lib/screener/bwibbu";

const daily: DailyRow[] = [
  { symbol: "2330", name: "台積電", open: 1080, high: 1090, low: 1075, close: 1085, volume: 21_000_000, change: 5, date: "2026-07-02" },
  { symbol: "0050", name: "元大台灣50", open: 200, high: 202, low: 199, close: 201, volume: 5_500_000, change: null, date: "2026-07-02" },
];
const valuation: ValuationRow[] = [
  { symbol: "2330", peRatio: 25.51, dividendYield: 1.55, pbRatio: 7.53 },
];

describe("buildSnapshot", () => {
  it("以 symbol join,換算漲跌%與張數,無估值者為 null", () => {
    const snap = buildSnapshot(daily, valuation);
    expect(snap.date).toBe("2026-07-02");
    expect(snap.rows).toHaveLength(2);
    const tsmc = snap.rows.find((r) => r.symbol === "2330")!;
    expect(tsmc.volumeLots).toBe(21000);
    expect(tsmc.changePct).toBeCloseTo((5 / 1080) * 100, 5); // 前收 = 1085 - 5
    expect(tsmc.peRatio).toBe(25.51);
    const etf = snap.rows.find((r) => r.symbol === "0050")!;
    expect(etf.changePct).toBeNull(); // 無 Change 欄
    expect(etf.peRatio).toBeNull();
  });
  it("前收 ≤ 0 時 changePct 為 null(除零保護)", () => {
    const weird: DailyRow[] = [{ ...daily[0], close: 5, change: 5 }];
    expect(buildSnapshot(weird, []).rows[0].changePct).toBeNull();
  });
});

describe("getScreenerSnapshot", () => {
  it("估值源失敗 → 估值欄全 null 仍回價量", async () => {
    const snap = await getScreenerSnapshot({
      daily: async () => daily,
      valuation: async () => { throw new Error("boom"); },
    });
    expect(snap.rows).toHaveLength(2);
    expect(snap.rows.every((r) => r.peRatio === null)).toBe(true);
  });
  it("價量源失敗 → throw", async () => {
    await expect(
      getScreenerSnapshot({ daily: async () => { throw new Error("down"); }, valuation: async () => valuation }),
    ).rejects.toThrow("down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/screener/__tests__/service.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/screener/service.ts
import { memoize } from "@/lib/quotes/cache";
import { fetchTwseDaily, type DailyRow } from "@/lib/ingest/twseOpenApi";
import { fetchBwibbu, type ValuationRow } from "@/lib/screener/bwibbu";
import type { ScreenerSnapshot } from "@/lib/screener/types";

export type SnapshotDeps = {
  daily?: () => Promise<DailyRow[]>;
  valuation?: () => Promise<ValuationRow[]>;
};

export function buildSnapshot(daily: DailyRow[], valuation: ValuationRow[]): ScreenerSnapshot {
  const bySymbol = new Map(valuation.map((v) => [v.symbol, v]));
  const rows = daily.map((d) => {
    const v = bySymbol.get(d.symbol);
    const prevClose = d.change == null ? null : d.close - d.change;
    return {
      symbol: d.symbol,
      name: d.name,
      close: d.close,
      changePct: prevClose != null && prevClose > 0 && d.change != null ? (d.change / prevClose) * 100 : null,
      volumeLots: Math.floor(d.volume / 1000),
      peRatio: v?.peRatio ?? null,
      dividendYield: v?.dividendYield ?? null,
      pbRatio: v?.pbRatio ?? null,
    };
  });
  return { date: daily[0]?.date ?? null, rows };
}

async function fetchSnapshot(deps: SnapshotDeps): Promise<ScreenerSnapshot> {
  const dailyRows = await (deps.daily ?? fetchTwseDaily)();
  let valuationRows: ValuationRow[] = [];
  try {
    valuationRows = await (deps.valuation ?? fetchBwibbu)();
  } catch {
    // 估值源失敗只影響估值欄(全 null),價量照常可篩
  }
  return buildSnapshot(dailyRows, valuationRows);
}

// 每日盤後資料,10min 快取(同 market-overview 模式)
const cachedSnapshot = memoize(() => fetchSnapshot({}), 600_000);

export async function getScreenerSnapshot(deps: SnapshotDeps = {}): Promise<ScreenerSnapshot> {
  if (deps.daily || deps.valuation) return fetchSnapshot(deps);
  return cachedSnapshot("snapshot");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/screener/__tests__/service.test.ts`
Expected: PASS(4 tests)。另跑 `pnpm exec tsc --noEmit` 確認型別。

- [ ] **Step 5: Commit**

```bash
git add lib/screener/service.ts lib/screener/__tests__/service.test.ts
git commit -m "feat: screener snapshot service(價量+估值 join,10min 快取,估值源容錯)"
```

---

### Task 5: API route + `/screener` 頁 UI

**Files:**
- Create: `app/api/screener/route.ts`
- Create: `app/screener/page.tsx`
- Create: `components/screener/ScreenerView.tsx`
- Create: `components/screener/ConditionPanel.tsx`
- Create: `components/screener/ResultList.tsx`

**Interfaces:**
- Consumes: `getScreenerSnapshot()`(Task 4)、`applyConditions`/`sortRows`/`PRESETS`/`CONDITION_DEFS`(Task 3)、`auth`(`@/auth`)、`AppShell`、`lib/format.ts`。
- Produces: GET `/api/screener` → `ScreenerSnapshot` JSON(401 未登入、502 上游失敗)。

- [ ] **Step 1: API route**

```ts
// app/api/screener/route.ts
import { auth } from "@/auth";
import { getScreenerSnapshot } from "@/lib/screener/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  try {
    const snapshot = await getScreenerSnapshot();
    return Response.json(snapshot);
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}
```

- [ ] **Step 2: Page**

```tsx
// app/screener/page.tsx
import AppShell from "@/components/layout/AppShell";
import ScreenerView from "@/components/screener/ScreenerView";

export default function ScreenerPage() {
  return <AppShell title="條件選股"><ScreenerView /></AppShell>;
}
```

- [ ] **Step 3: ScreenerView(client 狀態容器)**

```tsx
// components/screener/ScreenerView.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { applyConditions, sortRows, CONDITION_DEFS, PRESETS } from "@/lib/screener/engine";
import type { Condition, NumericField, ScreenerSnapshot } from "@/lib/screener/types";
import ConditionPanel from "@/components/screener/ConditionPanel";
import ResultList from "@/components/screener/ResultList";

const DEFAULT_PRESET = PRESETS[0];

export default function ScreenerView() {
  const [snapshot, setSnapshot] = useState<ScreenerSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(DEFAULT_PRESET.key);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => fromPreset(DEFAULT_PRESET.conditions).enabled);
  const [values, setValues] = useState<Record<string, number>>(() => fromPreset(DEFAULT_PRESET.conditions).values);
  const [sort, setSort] = useState(DEFAULT_PRESET.sort);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    fetch("/api/screener")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setSnapshot)
      .catch(() => setFailed(true));
  }, []);

  const conditions: Condition[] = useMemo(
    () => CONDITION_DEFS.filter((d) => enabled[d.field]).map((d) => ({ field: d.field, op: d.op, value: values[d.field] })),
    [enabled, values],
  );
  const results = useMemo(() => {
    if (!snapshot) return [];
    return sortRows(applyConditions(snapshot.rows, conditions), sort.field, sort.dir);
  }, [snapshot, conditions, sort]);

  function applyPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key)!;
    const next = fromPreset(p.conditions);
    setActiveKey(key); setEnabled(next.enabled); setValues(next.values); setSort(p.sort);
  }
  function markCustom() { setActiveKey("custom"); }

  if (failed) return <p className="text-gray-400">暫無資料,稍後再試</p>;
  if (!snapshot) return <p className="text-gray-400">載入中⋯</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3 py-1 text-sm ${activeKey === p.key ? "bg-up/20 text-up font-bold" : "bg-[var(--card)] text-gray-300"}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => { markCustom(); setPanelOpen(true); }}
            className={`rounded-full px-3 py-1 text-sm ${activeKey === "custom" ? "bg-up/20 text-up font-bold" : "bg-[var(--card)] text-gray-300"}`}>
            自訂
          </button>
        </div>
        {snapshot.date && <span className="text-xs text-gray-500">{snapshot.date}</span>}
      </div>

      <button onClick={() => setPanelOpen((o) => !o)} className="text-sm text-gray-400">
        {panelOpen ? "▾ 收合條件" : "▸ 調整條件"}
      </button>
      {panelOpen && (
        <ConditionPanel enabled={enabled} values={values}
          onToggle={(f: NumericField, on: boolean) => { setEnabled((e) => ({ ...e, [f]: on })); markCustom(); }}
          onValue={(f: NumericField, v: number) => { setValues((s) => ({ ...s, [f]: v })); markCustom(); }} />
      )}

      <ResultList rows={results} sort={sort} onSort={setSort} />
    </div>
  );
}

function fromPreset(conditions: Condition[]) {
  const enabled: Record<string, boolean> = {};
  const values: Record<string, number> = {};
  for (const d of CONDITION_DEFS) {
    const c = conditions.find((x) => x.field === d.field);
    enabled[d.field] = !!c;
    values[d.field] = c?.value ?? d.defaultValue;
  }
  return { enabled, values };
}
```

- [ ] **Step 4: ConditionPanel**

```tsx
// components/screener/ConditionPanel.tsx
"use client";
import { CONDITION_DEFS } from "@/lib/screener/engine";
import type { NumericField } from "@/lib/screener/types";

export default function ConditionPanel({
  enabled, values, onToggle, onValue,
}: {
  enabled: Record<string, boolean>;
  values: Record<string, number>;
  onToggle: (field: NumericField, on: boolean) => void;
  onValue: (field: NumericField, value: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-[var(--card)] p-4">
      {CONDITION_DEFS.map((d) => (
        <label key={d.field} className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={!!enabled[d.field]}
            onChange={(e) => onToggle(d.field, e.target.checked)} className="accent-[var(--up)]" />
          <span className={`w-28 ${enabled[d.field] ? "text-gray-200" : "text-gray-500"}`}>{d.label}</span>
          <input type="number" inputMode="decimal" value={values[d.field]} disabled={!enabled[d.field]}
            onChange={(e) => onValue(d.field, Number(e.target.value))}
            className="w-24 rounded bg-black/30 px-2 py-1 text-right disabled:opacity-40" />
          <span className="text-gray-500">{d.unit}</span>
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: ResultList(桌機表格/手機卡片,上限 100)**

```tsx
// components/screener/ResultList.tsx
"use client";
import Link from "next/link";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import type { NumericField, ScreenerRow } from "@/lib/screener/types";

const LIMIT = 100;
const COLS: { field: NumericField; label: string }[] = [
  { field: "close", label: "現價" },
  { field: "changePct", label: "漲跌%" },
  { field: "dividendYield", label: "殖利率" },
  { field: "peRatio", label: "本益比" },
  { field: "volumeLots", label: "張數" },
];

const dash = (v: number | null, fmt: (n: number) => string) => (v == null ? "—" : fmt(v));

export default function ResultList({
  rows, sort, onSort,
}: {
  rows: ScreenerRow[];
  sort: { field: NumericField; dir: "asc" | "desc" };
  onSort: (s: { field: NumericField; dir: "asc" | "desc" }) => void;
}) {
  const shown = rows.slice(0, LIMIT);
  const header = (
    <p className="text-sm text-gray-400">
      符合 {rows.length} 檔{rows.length > LIMIT ? `(僅列前 ${LIMIT})` : ""}
    </p>
  );
  function clickSort(field: NumericField) {
    onSort(sort.field === field ? { field, dir: sort.dir === "desc" ? "asc" : "desc" } : { field, dir: "desc" });
  }

  return (
    <div className="space-y-2">
      {header}

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {shown.map((r) => {
          const c = changeColorClass(r.changePct ?? 0);
          return (
            <Link key={r.symbol} href={`/stock/${r.symbol}`}
              className="flex items-center justify-between rounded-lg bg-[var(--card)] p-4">
              <div>
                <div className="font-bold">{r.name}</div>
                <div className="text-xs text-gray-400">{r.symbol}・{r.volumeLots.toLocaleString()} 張</div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${c}`}>{fmtPrice(r.close)}</div>
                <div className={`text-sm ${c}`}>{dash(r.changePct, fmtSignedPct)}</div>
                <div className="text-xs text-gray-400">
                  殖 {dash(r.dividendYield, (n) => `${n.toFixed(2)}%`)}・PE {dash(r.peRatio, (n) => n.toFixed(2))}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* 桌機:表格 */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-white/10 text-left text-gray-400">
            <th className="py-2">名稱</th>
            {COLS.map((col) => (
              <th key={col.field} className="cursor-pointer py-2 text-right" onClick={() => clickSort(col.field)}>
                {col.label}{sort.field === col.field ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const c = changeColorClass(r.changePct ?? 0);
            return (
              <tr key={r.symbol} className="border-b border-white/5">
                <td className="py-2">
                  <Link href={`/stock/${r.symbol}`}>{r.name}<span className="ml-2 text-xs text-gray-400">{r.symbol}</span></Link>
                </td>
                <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(r.close)}</td>
                <td className={`py-2 text-right ${c}`}>{dash(r.changePct, fmtSignedPct)}</td>
                <td className="py-2 text-right">{dash(r.dividendYield, (n) => `${n.toFixed(2)}%`)}</td>
                <td className="py-2 text-right">{dash(r.peRatio, (n) => n.toFixed(2))}</td>
                <td className="py-2 text-right text-gray-400">{r.volumeLots.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

注意:手機排序沿用目前 `sort` 狀態(preset 已給合理預設);手機版不做排序選單,列入 spec 既有的 polish 清單思路 —— 若實作中發現很便宜可加,不強制。
(spec 說「手機用排序選單」:實作時加一個 `<select>` 於 header 旁切換 sort field 即可,約 10 行;若 UI 擁擠可省略並回寫 spec。)

- [ ] **Step 6: Verify**

Run: `pnpm exec tsc --noEmit` → 無錯誤;`pnpm test` → 全綠;`pnpm build` → 成功(`/screener` 出現在 route 列表)。

- [ ] **Step 7: Commit**

```bash
git add app/api/screener app/screener components/screener
git commit -m "feat: /screener 條件選股頁(preset 策略+條件面板+前端過濾排序)"
```

---

### Task 6: E2E 驗證 + CLAUDE.md + 收尾

**Files:**
- Modify: `CLAUDE.md`(架構節新增 screener 模組、路線圖更新)
- Modify: `docs/superpowers/specs/2026-07-03-taidex-screener-design.md`(若實作有偏離,回寫)

- [ ] **Step 1: 本機 E2E**:`pnpm dev` + 依 memory「local-e2e-auth-bypass」偽造 authjs JWT cookie,curl `/api/screener` 確認 200 與 JSON 形狀;瀏覽器(或 headless)開 `/screener` 確認 preset 切換與條件調整會即時改變結果數。
- [ ] **Step 2: CLAUDE.md**:架構清單加一行 `**條件選股** lib/screener/…`(比照 market-overview 行文);路線圖將「條件選股」移入已上線,後續清單遞補;測試數字更新。
- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: CLAUDE.md 納入條件選股模組與路線圖更新"
```
