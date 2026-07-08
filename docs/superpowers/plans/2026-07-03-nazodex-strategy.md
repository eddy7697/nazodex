# 選股策略推薦(多因子評分)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 /strategy 提供多因子(價值/收息/動能/籌碼/熱度)截面評分的選股策略推薦,附白話理由與可調權重。

**Architecture:** 後端 `getStrategySnapshot()` 重用 screener 快照再 join 月均價(STOCK_DAY_AVG_ALL)與每股法人買賣超(T86),下發 `FactorRow[]`;百分位排名與加權計分為前後端共用的純函式(`lib/strategy/engine.ts`),在瀏覽器即時計算,切策略/調權重零延遲。無 DB、無 migration。

**Tech Stack:** Next.js App Router、TypeScript strict、Vitest、Tailwind(既有 CSS 變數紅漲綠跌)。

## Global Constraints

- spec:`docs/superpowers/specs/2026-07-03-nazodex-strategy-design.md`(權重表、因子定義、理由措辭以 spec 為準)
- 紅漲綠跌:顏色只用 `text-up`/`text-down`/`bg-up`(CSS 變數),元件不得寫死 hex。
- 價格顯示用 `lib/format.ts`(`fmtPrice`/`fmtSignedPct`)。
- 所有上游 fetch 8s AbortController;注入測試假 fetch 時簽名為 `typeof fetch`。
- TDD:每任務先寫失敗測試;commit message 用中文、conventional prefix。
- 測試指令:`pnpm vitest run <path>`;全套 `pnpm test`;型別 `pnpm exec tsc --noEmit`。

---

### Task 1: 月均價資料源 `lib/strategy/dayAvg.ts`

**Files:**
- Create: `lib/strategy/dayAvg.ts`
- Test: `lib/strategy/__tests__/dayAvg.test.ts`

**Interfaces:**
- Produces: `type DayAvgRow = { symbol: string; close: number; monthlyAvg: number }`、`parseDayAvg(json: unknown): DayAvgRow[]`、`fetchDayAvg(fetchImpl?: typeof fetch): Promise<DayAvgRow[]>`

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/strategy/__tests__/dayAvg.test.ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run lib/strategy/__tests__/dayAvg.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作**

```ts
// lib/strategy/dayAvg.ts
type Raw = Record<string, string>;
export type DayAvgRow = { symbol: string; close: number; monthlyAvg: number };

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDayAvg(json: unknown): DayAvgRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: DayAvgRow[] = [];
  for (const r of arr) {
    const symbol = (r.Code ?? "").trim();
    const close = num(r.ClosingPrice);
    const monthlyAvg = num(r.MonthlyAveragePrice);
    if (!symbol || close == null || monthlyAvg == null || monthlyAvg <= 0) continue;
    out.push({ symbol, close, monthlyAvg });
  }
  return out;
}

export async function fetchDayAvg(fetchImpl: typeof fetch = fetch): Promise<DayAvgRow[]> {
  // 8s abort,避免上游卡住(同 twseOpenApi 模式)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status}`);
    return parseDayAvg(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run lib/strategy/__tests__/dayAvg.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/dayAvg.ts lib/strategy/__tests__/dayAvg.test.ts
git commit -m "feat: 月均價資料源 STOCK_DAY_AVG_ALL(動能因子輸入)"
```

---

### Task 2: 每股法人買賣超資料源 `lib/strategy/t86.ts`

**Files:**
- Create: `lib/strategy/t86.ts`
- Test: `lib/strategy/__tests__/t86.test.ts`

**Interfaces:**
- Produces: `type T86Row = { symbol: string; totalNetShares: number }`、`parseT86(json: unknown): T86Row[]`(stat!=="OK" → throw)、`fetchT86(fetchImpl?: typeof fetch): Promise<T86Row[]>`

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/strategy/__tests__/t86.test.ts
import { describe, it, expect } from "vitest";
import { parseT86 } from "@/lib/strategy/t86";

const doc = {
  stat: "OK",
  date: "20260702",
  fields: ["證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "三大法人買賣超股數"],
  data: [
    ["2330", "台積電          ", "52,683,779", "12,345,678"],
    ["1101", "台泥", "100", "-2,000"],
    ["9999", "壞列", "1", "-"],
  ],
};

describe("parseT86", () => {
  it("以「三大法人買賣超股數」欄名取值,千分位與負數可解,代號 trim", () => {
    expect(parseT86(doc)).toEqual([
      { symbol: "2330", totalNetShares: 12_345_678 },
      { symbol: "1101", totalNetShares: -2000 },
    ]);
  });
  it("找不到欄名時退回最後一欄", () => {
    const noFields = { ...doc, fields: ["證券代號", "證券名稱", "甲", "乙"] };
    expect(parseT86(noFields)[0].totalNetShares).toBe(12_345_678);
  });
  it("stat 非 OK → throw", () => {
    expect(() => parseT86({ stat: "很抱歉,沒有符合條件的資料!" })).toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run lib/strategy/__tests__/t86.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作**

```ts
// lib/strategy/t86.ts
type RwdT86 = { stat?: string; date?: string; fields?: string[]; data?: string[][] };
export type T86Row = { symbol: string; totalNetShares: number };

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseT86(json: unknown): T86Row[] {
  const doc = json as RwdT86 | null;
  if (doc?.stat !== "OK" || !Array.isArray(doc.data)) throw new Error("T86 unavailable");
  const byName = (doc.fields ?? []).indexOf("三大法人買賣超股數");
  const out: T86Row[] = [];
  for (const row of doc.data) {
    const symbol = (row[0] ?? "").trim();
    const col = byName >= 0 ? byName : row.length - 1; // 官方表最後一欄即合計
    const net = num(row[col]);
    if (!symbol || net == null) continue;
    out.push({ symbol, totalNetShares: net });
  }
  return out;
}

export async function fetchT86(fetchImpl: typeof fetch = fetch): Promise<T86Row[]> {
  // 不帶 date 參數 → TWSE 自動回最新交易日;ALLBUT0999 排除權證類
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://www.twse.com.tw/rwd/zh/fund/T86?selectType=ALLBUT0999&response=json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TWSE rwd failed: ${res.status}`);
    return parseT86(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run lib/strategy/__tests__/t86.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/t86.ts lib/strategy/__tests__/t86.test.ts
git commit -m "feat: 每股三大法人買賣超資料源 T86(籌碼因子輸入)"
```

---

### Task 3: 型別與因子評分引擎(百分位)`lib/strategy/types.ts` + `engine.ts` 前半

**Files:**
- Create: `lib/strategy/types.ts`
- Create: `lib/strategy/engine.ts`
- Test: `lib/strategy/__tests__/engine.test.ts`

**Interfaces:**
- Produces(types.ts):

```ts
import type { ScreenerRow } from "@/lib/screener/types";

export type FactorRow = ScreenerRow & {
  biasPct: number | null;    // 月線乖離%
  chipsRatio: number | null; // 三大法人買賣超佔成交量%(可負)
};
export type StrategySnapshot = { date: string | null; rows: FactorRow[] };
export type FactorKey = "value" | "dividend" | "momentum" | "chips" | "heat";
export type Weights = Record<FactorKey, number>;
export type FactorScores = Record<FactorKey, number | null>;
export type StrategyDef = { key: string; label: string; blurb: string; weights: Weights };
export type Recommendation = { row: FactorRow; score: number; factors: FactorScores; reasons: string[] };
```

- Produces(engine.ts 本任務部分):`inUniverse(r: FactorRow): boolean`、`percentileRanks(values: (number|null)[]): (number|null)[]`、`computeFactorScores(rows: FactorRow[]): FactorScores[]`、常數 `FACTOR_KEYS: FactorKey[]`、`FACTOR_LABELS: Record<FactorKey, string>`

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/strategy/__tests__/engine.test.ts
import { describe, it, expect } from "vitest";
import { computeFactorScores, inUniverse, percentileRanks } from "@/lib/strategy/engine";
import type { FactorRow } from "@/lib/strategy/types";

export function makeRow(over: Partial<FactorRow>): FactorRow {
  return {
    symbol: "0000", name: "測試", close: 100, changePct: 0, volumeLots: 1000,
    peRatio: 15, dividendYield: 4, pbRatio: 1.5, biasPct: 0, chipsRatio: 0,
    ...over,
  };
}

describe("percentileRanks", () => {
  it("嚴格小於計數 / (n-1) × 100;null 保持 null 且不入母體", () => {
    expect(percentileRanks([10, 20, null, 30])).toEqual([0, 50, null, 100]);
  });
  it("同值同名次(ties 取相同百分位)", () => {
    const [a, b, c] = percentileRanks([5, 5, 9]);
    expect(a).toBe(b);
    expect(c).toBe(100);
  });
  it("母體 < 2 → 50", () => {
    expect(percentileRanks([7, null])).toEqual([50, null]);
  });
});

describe("inUniverse", () => {
  it("成交 ≥ 200 張且股價 ≥ 5 元", () => {
    expect(inUniverse(makeRow({ volumeLots: 200, close: 5 }))).toBe(true);
    expect(inUniverse(makeRow({ volumeLots: 199 }))).toBe(false);
    expect(inUniverse(makeRow({ close: 4.9 }))).toBe(false);
  });
});

describe("computeFactorScores", () => {
  it("價值取 PE/PB 低者佳均值;收息/籌碼/熱度高者佳;動能為乖離+漲幅均值", () => {
    const rows = [
      makeRow({ peRatio: 10, pbRatio: 1, dividendYield: 6, biasPct: 5, changePct: 3, chipsRatio: 2, volumeLots: 5000 }),
      makeRow({ peRatio: 30, pbRatio: 3, dividendYield: 1, biasPct: -5, changePct: -3, chipsRatio: -2, volumeLots: 300 }),
    ];
    const [good, bad] = computeFactorScores(rows);
    expect(good.value).toBe(100);   // PE、PB 皆最低 → 低者佳 100
    expect(bad.value).toBe(0);
    expect(good.dividend).toBe(100);
    expect(good.momentum).toBe(100);
    expect(good.chips).toBe(100);
    expect(good.heat).toBe(100);
    expect(bad.heat).toBe(0);
  });
  it("因子輸入 null → 該因子 null;單邊 null 的複合因子取另一邊", () => {
    const rows = [
      makeRow({ peRatio: null, pbRatio: null, dividendYield: null, biasPct: null, changePct: 2 }),
      makeRow({ peRatio: 10, pbRatio: 1, dividendYield: 3, biasPct: 1, changePct: 1 }),
    ];
    const [etf] = computeFactorScores(rows);
    expect(etf.value).toBeNull();
    expect(etf.dividend).toBeNull();
    expect(etf.momentum).toBe(100); // 只剩 changePct,2 > 1
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run lib/strategy/__tests__/engine.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作**

先建 `lib/strategy/types.ts`(內容如上方 Interfaces 區塊,完整照抄)。再建 `lib/strategy/engine.ts`:

```ts
// lib/strategy/engine.ts
import type { FactorKey, FactorRow, FactorScores } from "@/lib/strategy/types";

export const UNIVERSE_MIN_LOTS = 200; // 排除殭屍股
export const UNIVERSE_MIN_CLOSE = 5;  // 排除雞蛋水餃股

export const FACTOR_KEYS: FactorKey[] = ["value", "dividend", "momentum", "chips", "heat"];
export const FACTOR_LABELS: Record<FactorKey, string> = {
  value: "價值", dividend: "收息", momentum: "動能", chips: "籌碼", heat: "熱度",
};

export function inUniverse(r: FactorRow): boolean {
  return r.volumeLots >= UNIVERSE_MIN_LOTS && r.close >= UNIVERSE_MIN_CLOSE;
}

// 百分位(高者佳):嚴格小於該值的檔數/(母體-1)×100;null 不入母體;母體<2 → 50
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    if (v == null) return null;
    if (n < 2) return 50;
    let lo = 0, hi = n; // lower bound 二分:嚴格小於 v 的個數
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return (lo / (n - 1)) * 100;
  });
}

const invert = (p: number | null): number | null => (p == null ? null : 100 - p);
const mean2 = (a: number | null, b: number | null): number | null =>
  a == null && b == null ? null : a == null ? b : b == null ? a : (a + b) / 2;

// rows 應已通過 inUniverse 門檻;回傳與 rows 逐列對齊的五因子分數(0–100 或 null)
export function computeFactorScores(rows: FactorRow[]): FactorScores[] {
  const peLow = percentileRanks(rows.map((r) => r.peRatio)).map(invert);
  const pbLow = percentileRanks(rows.map((r) => r.pbRatio)).map(invert);
  const yieldHigh = percentileRanks(rows.map((r) => r.dividendYield));
  const biasHigh = percentileRanks(rows.map((r) => r.biasPct));
  const chgHigh = percentileRanks(rows.map((r) => r.changePct));
  const chipsHigh = percentileRanks(rows.map((r) => r.chipsRatio));
  const heatHigh = percentileRanks(rows.map((r) => r.volumeLots));
  return rows.map((_, i) => ({
    value: mean2(peLow[i], pbLow[i]),
    dividend: yieldHigh[i],
    momentum: mean2(biasHigh[i], chgHigh[i]),
    chips: chipsHigh[i],
    heat: heatHigh[i],
  }));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run lib/strategy/__tests__/engine.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/types.ts lib/strategy/engine.ts lib/strategy/__tests__/engine.test.ts
git commit -m "feat: 策略引擎前半——評分宇宙門檻與五因子百分位評分"
```

---

### Task 4: 策略權重、綜合分數與推薦理由(engine.ts 後半)

**Files:**
- Modify: `lib/strategy/engine.ts`(追加於檔尾)
- Test: `lib/strategy/__tests__/engine.test.ts`(追加)

**Interfaces:**
- Consumes: Task 3 的 `computeFactorScores`/`inUniverse`/`FACTOR_KEYS`
- Produces: `MIN_FACTORS = 3`、`compositeScore(f: FactorScores, weights: Weights): number | null`、`buildReasons(f: FactorScores, row: FactorRow): string[]`、`recommend(rows: FactorRow[], weights: Weights, topN?: number): Recommendation[]`、`STRATEGIES: StrategyDef[]`(5 檔,權重和 = 1)

- [ ] **Step 1: 追加失敗測試**

```ts
// 追加至 lib/strategy/__tests__/engine.test.ts
import { buildReasons, compositeScore, recommend, STRATEGIES } from "@/lib/strategy/engine";
import type { FactorScores, Weights } from "@/lib/strategy/types";

const W: Weights = { value: 0.2, dividend: 0.2, momentum: 0.2, chips: 0.2, heat: 0.2 };

describe("compositeScore", () => {
  it("加權平均", () => {
    const f: FactorScores = { value: 100, dividend: 50, momentum: 0, chips: 50, heat: 50 };
    expect(compositeScore(f, W)).toBe(50);
  });
  it("缺因子 → 權重再正規化(不拖分)", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: 80, chips: 80, heat: 80 };
    expect(compositeScore(f, W)).toBe(80);
  });
  it("非 null 因子 < 3 → null(不進榜)", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: null, chips: 90, heat: 90 };
    expect(compositeScore(f, W)).toBeNull();
  });
});

describe("STRATEGIES", () => {
  it("5 檔策略,權重和皆為 1", () => {
    expect(STRATEGIES).toHaveLength(5);
    expect(STRATEGIES.map((s) => s.key)).toEqual(["balanced", "income", "value", "momentum", "chips"]);
    for (const s of STRATEGIES) {
      const sum = Object.values(s.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });
});

describe("buildReasons", () => {
  it("取分數最高兩因子,>=90 用「前 X%」、其餘用「贏過 X%」", () => {
    const f: FactorScores = { value: 20, dividend: 95, momentum: 60, chips: 30, heat: 10 };
    const reasons = buildReasons(f, makeRow({ biasPct: null }));
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toBe("殖利率前 5%");
    expect(reasons[1]).toBe("價格動能贏過 60% 的股票");
  });
  it("動能站上月均線時帶乖離數字", () => {
    const f: FactorScores = { value: null, dividend: null, momentum: 92, chips: 10, heat: 20 };
    const reasons = buildReasons(f, makeRow({ biasPct: 4.2 }));
    expect(reasons[0]).toBe("站上月均線 +4.2%,動能前 8%");
  });
});

describe("recommend", () => {
  it("過濾 universe、依綜合分數排序取 topN,同分以張數 tie-break", () => {
    const rows = [
      makeRow({ symbol: "GOOD", peRatio: 8, pbRatio: 0.8, dividendYield: 7, biasPct: 6, changePct: 4, chipsRatio: 3, volumeLots: 9000 }),
      makeRow({ symbol: "MID", peRatio: 15, pbRatio: 1.5, dividendYield: 4, biasPct: 0, changePct: 0, chipsRatio: 0, volumeLots: 800 }),
      makeRow({ symbol: "BAD", peRatio: 40, pbRatio: 4, dividendYield: 0.5, biasPct: -8, changePct: -4, chipsRatio: -3, volumeLots: 600 }),
      makeRow({ symbol: "TINY", volumeLots: 50 }), // 不在 universe
    ];
    const recs = recommend(rows, W, 2);
    expect(recs.map((r) => r.row.symbol)).toEqual(["GOOD", "MID"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
    expect(recs[0].reasons.length).toBe(2);
    expect(recs.some((r) => r.row.symbol === "TINY")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run lib/strategy/__tests__/engine.test.ts`
Expected: FAIL(`compositeScore` 等未定義)

- [ ] **Step 3: 實作(追加至 engine.ts 檔尾)**

```ts
import type { Recommendation, StrategyDef, Weights } from "@/lib/strategy/types";
// ↑ 併入檔頭既有 import type 行

export const MIN_FACTORS = 3; // 資料太殘缺的股票不進榜

export function compositeScore(f: FactorScores, weights: Weights): number | null {
  let num = 0, den = 0, count = 0;
  for (const k of FACTOR_KEYS) {
    const v = f[k];
    if (v == null) continue;
    num += weights[k] * v;
    den += weights[k];
    count++;
  }
  if (count < MIN_FACTORS || den <= 0) return null;
  return num / den;
}

// ≥90 分講「前 X%」更有力,其餘講「贏過 X%」
function pctPhrase(score: number): string {
  if (score >= 90) return `前 ${Math.max(1, Math.round(100 - score))}%`;
  return `贏過 ${Math.round(score)}% 的股票`;
}

function reasonText(k: FactorKey, score: number, row: FactorRow): string {
  switch (k) {
    case "value": return `估值便宜度${pctPhrase(score)}`;
    case "dividend": return `殖利率${pctPhrase(score)}`;
    case "momentum":
      return row.biasPct != null && row.biasPct > 0
        ? `站上月均線 +${row.biasPct.toFixed(1)}%,動能${pctPhrase(score)}`
        : `價格動能${pctPhrase(score)}`;
    case "chips": return `法人買超力道${pctPhrase(score)}`;
    case "heat": return `成交熱度${pctPhrase(score)}`;
  }
}

// 只描述事實不喊買賣;取分數最高兩因子
export function buildReasons(f: FactorScores, row: FactorRow): string[] {
  return FACTOR_KEYS
    .filter((k) => f[k] != null)
    .sort((a, b) => f[b]! - f[a]!)
    .slice(0, 2)
    .map((k) => reasonText(k, f[k]!, row));
}

export function recommend(rows: FactorRow[], weights: Weights, topN = 20): Recommendation[] {
  const universe = rows.filter(inUniverse);
  const scores = computeFactorScores(universe);
  const recs: Recommendation[] = [];
  for (let i = 0; i < universe.length; i++) {
    const score = compositeScore(scores[i], weights);
    if (score == null) continue;
    recs.push({ row: universe[i], score, factors: scores[i], reasons: buildReasons(scores[i], universe[i]) });
  }
  recs.sort((a, b) => b.score - a.score || b.row.volumeLots - a.row.volumeLots);
  return recs.slice(0, topN);
}

export const STRATEGIES: StrategyDef[] = [
  { key: "balanced", label: "均衡精選", blurb: "五力平均、體質全面",
    weights: { value: 0.25, dividend: 0.25, momentum: 0.2, chips: 0.2, heat: 0.1 } },
  { key: "income", label: "存股收息", blurb: "領股息為主,兼顧不買貴",
    weights: { value: 0.25, dividend: 0.45, momentum: 0.05, chips: 0.15, heat: 0.1 } },
  { key: "value", label: "價值獵手", blurb: "便宜是硬道理",
    weights: { value: 0.5, dividend: 0.2, momentum: 0.05, chips: 0.15, heat: 0.1 } },
  { key: "momentum", label: "動能突擊", blurb: "順勢而為、量價齊揚",
    weights: { value: 0.05, dividend: 0.05, momentum: 0.45, chips: 0.25, heat: 0.2 } },
  { key: "chips", label: "主力同行", blurb: "跟著法人腳步",
    weights: { value: 0.1, dividend: 0.05, momentum: 0.2, chips: 0.5, heat: 0.15 } },
];
```

注意:`FactorScores`/`FactorKey`/`FactorRow` 已在檔頭 import,追加的 `Recommendation, StrategyDef, Weights` 併入同一行 import type。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run lib/strategy/__tests__/engine.test.ts`
Expected: PASS(Task 3+4 全部)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/engine.ts lib/strategy/__tests__/engine.test.ts
git commit -m "feat: 策略引擎後半——五策略權重、綜合分數與白話推薦理由"
```

---

### Task 5: 快照服務 `lib/strategy/service.ts`

**Files:**
- Create: `lib/strategy/service.ts`
- Test: `lib/strategy/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `getScreenerSnapshot`(既有)、Task 1 `DayAvgRow`/`fetchDayAvg`、Task 2 `T86Row`/`fetchT86`、Task 3 `FactorRow`/`StrategySnapshot`
- Produces: `buildFactorRows(snap: ScreenerSnapshot, dayAvg: DayAvgRow[], t86: T86Row[]): StrategySnapshot`、`getStrategySnapshot(deps?: StrategyDeps): Promise<StrategySnapshot>`,其中 `StrategyDeps = { screener?: () => Promise<ScreenerSnapshot>; dayAvg?: () => Promise<DayAvgRow[]>; t86?: () => Promise<T86Row[]> }`

- [ ] **Step 1: 寫失敗測試**

```ts
// lib/strategy/__tests__/service.test.ts
import { describe, it, expect } from "vitest";
import { buildFactorRows, getStrategySnapshot } from "@/lib/strategy/service";
import type { ScreenerSnapshot } from "@/lib/screener/types";

const snap: ScreenerSnapshot = {
  date: "2026-07-02",
  rows: [
    { symbol: "2330", name: "台積電", close: 1085, changePct: 0.46, volumeLots: 21000, peRatio: 25.5, dividendYield: 1.55, pbRatio: 7.5 },
    { symbol: "1101", name: "台泥", close: 30, changePct: null, volumeLots: 0, peRatio: null, dividendYield: null, pbRatio: null },
  ],
};

describe("buildFactorRows", () => {
  it("join 月均與 T86,算 biasPct 與 chipsRatio(佔成交量%)", () => {
    const out = buildFactorRows(snap,
      [{ symbol: "2330", close: 1085, monthlyAvg: 1000 }],
      [{ symbol: "2330", totalNetShares: 2_100_000 }]);
    const tsmc = out.rows.find((r) => r.symbol === "2330")!;
    expect(tsmc.biasPct).toBeCloseTo(8.5, 5);        // (1085-1000)/1000×100
    expect(tsmc.chipsRatio).toBeCloseTo(10, 5);      // 2,100,000 / 21,000,000 股 ×100
    expect(out.date).toBe("2026-07-02");
  });
  it("無對應月均/法人、或成交量 0 → null(除零保護)", () => {
    const out = buildFactorRows(snap, [], [{ symbol: "1101", totalNetShares: 5000 }]);
    const cement = out.rows.find((r) => r.symbol === "1101")!;
    expect(cement.biasPct).toBeNull();
    expect(cement.chipsRatio).toBeNull(); // volumeLots 0
  });
});

describe("getStrategySnapshot", () => {
  it("月均/T86 源失敗 → 對應欄全 null 仍回快照(區塊容錯)", async () => {
    const out = await getStrategySnapshot({
      screener: async () => snap,
      dayAvg: async () => { throw new Error("avg down"); },
      t86: async () => { throw new Error("t86 down"); },
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.biasPct === null && r.chipsRatio === null)).toBe(true);
  });
  it("價量(screener)源失敗 → throw", async () => {
    await expect(
      getStrategySnapshot({ screener: async () => { throw new Error("down"); }, dayAvg: async () => [], t86: async () => [] }),
    ).rejects.toThrow("down");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run lib/strategy/__tests__/service.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作**

```ts
// lib/strategy/service.ts
import { memoize } from "@/lib/quotes/cache";
import { getScreenerSnapshot } from "@/lib/screener/service";
import type { ScreenerSnapshot } from "@/lib/screener/types";
import { fetchDayAvg, type DayAvgRow } from "@/lib/strategy/dayAvg";
import { fetchT86, type T86Row } from "@/lib/strategy/t86";
import type { FactorRow, StrategySnapshot } from "@/lib/strategy/types";

export type StrategyDeps = {
  screener?: () => Promise<ScreenerSnapshot>;
  dayAvg?: () => Promise<DayAvgRow[]>;
  t86?: () => Promise<T86Row[]>;
};

export function buildFactorRows(snap: ScreenerSnapshot, dayAvg: DayAvgRow[], t86: T86Row[]): StrategySnapshot {
  const avgBySymbol = new Map(dayAvg.map((d) => [d.symbol, d.monthlyAvg]));
  const netBySymbol = new Map(t86.map((t) => [t.symbol, t.totalNetShares]));
  const rows: FactorRow[] = snap.rows.map((r) => {
    const avg = avgBySymbol.get(r.symbol);
    const net = netBySymbol.get(r.symbol);
    const volShares = r.volumeLots * 1000;
    return {
      ...r,
      biasPct: avg != null ? ((r.close - avg) / avg) * 100 : null, // parser 已保證 avg > 0
      chipsRatio: net != null && volShares > 0 ? (net / volShares) * 100 : null,
    };
  });
  return { date: snap.date, rows };
}

async function fetchStrategySnapshot(deps: StrategyDeps): Promise<StrategySnapshot> {
  const snap = await (deps.screener ?? getScreenerSnapshot)();
  let dayAvg: DayAvgRow[] = [];
  try {
    dayAvg = await (deps.dayAvg ?? fetchDayAvg)();
  } catch {
    // 月均源失敗 → biasPct 全 null,動能因子退化為當日漲幅
  }
  let t86: T86Row[] = [];
  try {
    t86 = await (deps.t86 ?? fetchT86)();
  } catch {
    // 籌碼源失敗 → chipsRatio 全 null,權重再正規化自然吸收
  }
  return buildFactorRows(snap, dayAvg, t86);
}

// 每日盤後資料,10min 快取(同 screener 模式;內層 screener 快照另有自己的快取)
const cachedSnapshot = memoize(() => fetchStrategySnapshot({}), 600_000);

export async function getStrategySnapshot(deps: StrategyDeps = {}): Promise<StrategySnapshot> {
  if (deps.screener || deps.dayAvg || deps.t86) return fetchStrategySnapshot(deps);
  return cachedSnapshot("snapshot");
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run lib/strategy/__tests__/service.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy/service.ts lib/strategy/__tests__/service.test.ts
git commit -m "feat: 策略因子快照服務(重用 screener 快照 + 月均/T86 join,區塊容錯)"
```

---

### Task 6: API route 與頁面骨架 + 導覽分頁

**Files:**
- Create: `app/api/strategy/route.ts`
- Create: `app/strategy/page.tsx`
- Modify: `components/layout/BottomNav.tsx:5-10`(tabs 陣列加一項)

**Interfaces:**
- Consumes: Task 5 `getStrategySnapshot`
- Produces: `GET /api/strategy` → `StrategySnapshot` JSON(401/502 同 screener);頁面 `/strategy`(StrategyView 於 Task 7 建立,本任務先建 route 與 nav,頁面檔一併建立但引用 Task 7 的元件——**因此本任務與 Task 7 同一 commit 前不可單獨 build**;為保持每 commit 可 build,本任務只建 route + BottomNav,頁面檔留給 Task 7)

- [ ] **Step 1: 建立 API route**

```ts
// app/api/strategy/route.ts
import { auth } from "@/auth";
import { getStrategySnapshot } from "@/lib/strategy/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  try {
    const snapshot = await getStrategySnapshot();
    return Response.json(snapshot);
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}
```

- [ ] **Step 2: BottomNav 加「策略」分頁**

```tsx
// components/layout/BottomNav.tsx 的 tabs 改為:
const tabs = [
  { href: "/", label: "自選" },
  { href: "/market", label: "大盤" },
  { href: "/screener", label: "選股" },
  { href: "/strategy", label: "策略" },
  { href: "/holdings", label: "持股" },
];
```

- [ ] **Step 3: 驗證型別**

Run: `pnpm exec tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 4: Commit**

```bash
git add app/api/strategy/route.ts components/layout/BottomNav.tsx
git commit -m "feat: 策略推薦 API route 與底部導覽「策略」分頁"
```

---

### Task 7: 前端 UI(StrategyView / StrategyCard / WeightPanel + 頁面)

**Files:**
- Create: `components/strategy/WeightPanel.tsx`
- Create: `components/strategy/StrategyCard.tsx`
- Create: `components/strategy/StrategyView.tsx`
- Create: `app/strategy/page.tsx`

**Interfaces:**
- Consumes: Task 3/4 `recommend`/`STRATEGIES`/`FACTOR_KEYS`/`FACTOR_LABELS`、Task 6 `GET /api/strategy`、既有 `changeColorClass`/`fmtPrice`/`fmtSignedPct`、`GET/POST /api/watchlist`
- Produces: 頁面 `/strategy`

- [ ] **Step 1: WeightPanel**

```tsx
// components/strategy/WeightPanel.tsx
"use client";
import { FACTOR_KEYS, FACTOR_LABELS } from "@/lib/strategy/engine";
import type { Weights } from "@/lib/strategy/types";

export default function WeightPanel({
  weights, onChange,
}: { weights: Weights; onChange: (w: Weights) => void }) {
  return (
    <div className="space-y-2 rounded-lg bg-[var(--card)] p-4">
      {FACTOR_KEYS.map((k) => (
        <label key={k} className="flex items-center gap-3 text-sm">
          <span className="w-10 shrink-0 text-gray-300">{FACTOR_LABELS[k]}</span>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(weights[k] * 100)}
            onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) / 100 })}
            className="flex-1 accent-[var(--up)]"
            aria-label={`${FACTOR_LABELS[k]}權重`}
          />
          <span className="w-8 shrink-0 text-right text-xs text-gray-400">{Math.round(weights[k] * 100)}</span>
        </label>
      ))}
      <p className="text-xs text-gray-500">權重看相對大小,計分時自動按比例正規化</p>
    </div>
  );
}
```

- [ ] **Step 2: StrategyCard**

```tsx
// components/strategy/StrategyCard.tsx
"use client";
import Link from "next/link";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import { FACTOR_KEYS, FACTOR_LABELS } from "@/lib/strategy/engine";
import type { Recommendation } from "@/lib/strategy/types";

function FactorBars({ factors }: { factors: Recommendation["factors"] }) {
  return (
    <div className="flex gap-2">
      {FACTOR_KEYS.map((k) => {
        const v = factors[k];
        return (
          <div key={k} className="flex-1">
            <div className="h-1.5 overflow-hidden rounded bg-white/10">
              {v != null && <div className="h-full rounded bg-up" style={{ width: `${v}%` }} />}
            </div>
            <div className="mt-0.5 text-center text-[10px] text-gray-500">
              {FACTOR_LABELS[k]}{v == null ? "—" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StrategyCard({
  rank, rec, watched, onAdd,
}: { rank: number; rec: Recommendation; watched: Set<string>; onAdd: (symbol: string) => void }) {
  const { row, score, factors, reasons } = rec;
  const c = changeColorClass(row.changePct ?? 0);
  const added = watched.has(row.symbol);
  return (
    <Link href={`/stock/${row.symbol}`} className="block rounded-lg bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-6 text-center text-sm font-bold text-gray-500">{rank}</span>
          <div>
            <div className="font-bold">{row.name}</div>
            <div className="text-xs text-gray-400">{row.symbol}・{row.volumeLots.toLocaleString()} 張</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`font-bold ${c}`}>{fmtPrice(row.close)}</div>
          <div className={`text-sm ${c}`}>{row.changePct == null ? "—" : fmtSignedPct(row.changePct)}</div>
        </div>
        <div className="ml-3 text-right">
          <div className="text-lg font-bold text-up">{Math.round(score)}</div>
          <div className="text-[10px] text-gray-500">綜合分</div>
        </div>
      </div>
      <div className="mt-3"><FactorBars factors={factors} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {reasons.map((r) => (
          <span key={r} className="rounded bg-white/5 px-2 py-0.5 text-xs text-gray-300">{r}</span>
        ))}
        <button
          disabled={added}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd(row.symbol); }}
          className={`ml-auto rounded px-2 py-1 text-xs ${added ? "text-gray-500" : "bg-white/5 text-gray-300"}`}
          aria-label={added ? "已在自選" : "加入自選"}
        >
          {added ? "✓ 已加" : "＋自選"}
        </button>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: StrategyView + 頁面**

```tsx
// components/strategy/StrategyView.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { recommend, STRATEGIES } from "@/lib/strategy/engine";
import type { StrategySnapshot, Weights } from "@/lib/strategy/types";
import StrategyCard from "@/components/strategy/StrategyCard";
import WeightPanel from "@/components/strategy/WeightPanel";

const DEFAULT = STRATEGIES[0];
const TOP_N = 20;

export default function StrategyView() {
  const [snapshot, setSnapshot] = useState<StrategySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeKey, setActiveKey] = useState(DEFAULT.key);
  const [weights, setWeights] = useState<Weights>(DEFAULT.weights);
  const [panelOpen, setPanelOpen] = useState(false);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/strategy")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setSnapshot)
      .catch(() => setFailed(true));
    // 已在自選的股票顯示 ✓,避免重複加入(同 screener)
    fetch("/api/watchlist")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => setWatched(new Set((json.items ?? []).map((i: { stockSymbol: string }) => i.stockSymbol))))
      .catch(() => {});
  }, []);

  async function addToWatchlist(symbol: string) {
    setWatched((w) => new Set(w).add(symbol)); // 樂觀更新
    const res = await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) setWatched((w) => { const next = new Set(w); next.delete(symbol); return next; });
  }

  const recs = useMemo(
    () => (snapshot ? recommend(snapshot.rows, weights, TOP_N) : []),
    [snapshot, weights],
  );

  function applyStrategy(key: string) {
    const s = STRATEGIES.find((x) => x.key === key)!;
    setActiveKey(key);
    setWeights(s.weights);
  }

  if (failed) return <p className="text-gray-400">暫無資料,稍後再試</p>;
  if (!snapshot) return <p className="text-gray-400">載入中⋯</p>;

  const active = STRATEGIES.find((s) => s.key === activeKey);
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm ${on ? "bg-white/10 text-up font-bold" : "bg-[var(--card)] text-gray-300"}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {STRATEGIES.map((s) => (
            <button key={s.key} onClick={() => applyStrategy(s.key)} className={chip(activeKey === s.key)}>
              {s.label}
            </button>
          ))}
          <button onClick={() => { setActiveKey("custom"); setPanelOpen(true); }} className={chip(activeKey === "custom")}>
            自訂配方
          </button>
        </div>
        {snapshot.date && <span className="text-xs text-gray-500">{snapshot.date}</span>}
      </div>

      <p className="text-xs text-gray-500">{activeKey === "custom" ? "自己調配五力權重" : active?.blurb}</p>

      <button onClick={() => setPanelOpen((o) => !o)} className="text-sm text-gray-400">
        {panelOpen ? "▾ 收合配方" : "▸ 調整配方"}
      </button>
      {panelOpen && (
        <WeightPanel weights={weights} onChange={(w) => { setWeights(w); setActiveKey("custom"); }} />
      )}

      <div className="grid gap-2 md:grid-cols-2">
        {recs.map((rec, i) => (
          <StrategyCard key={rec.row.symbol} rank={i + 1} rec={rec} watched={watched} onAdd={addToWatchlist} />
        ))}
      </div>
      {recs.length === 0 && <p className="text-gray-400">今日無符合條件的標的</p>}

      <p className="pb-2 text-center text-xs text-gray-600">依公開市場數據計算,僅供學習參考,非投資建議</p>
    </div>
  );
}
```

```tsx
// app/strategy/page.tsx
import AppShell from "@/components/layout/AppShell";
import StrategyView from "@/components/strategy/StrategyView";

export default function StrategyPage() {
  return <AppShell title="策略推薦"><StrategyView /></AppShell>;
}
```

- [ ] **Step 4: 驗證**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 型別無錯、全套測試 PASS

- [ ] **Step 5: Commit**

```bash
git add components/strategy app/strategy
git commit -m "feat: 策略推薦頁——策略 chips、推薦卡片(因子條/理由)、權重配方面板"
```

---

### Task 8: 全量驗證與文件

**Files:**
- Modify: `CLAUDE.md`(架構節加「策略推薦」一段、路線圖更新)

- [ ] **Step 1: 全量驗證**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: 全綠、build 成功

- [ ] **Step 2: 本機 E2E**

以既有 headless 驗證法(forge authjs JWT cookie,見 memory `local-e2e-auth-bypass`)啟 `pnpm dev`,
GET `/api/strategy` 應回 200 且 rows > 500;`/strategy` 頁應渲染 20 張卡片與 5 顆策略 chips。

- [ ] **Step 3: 更新 CLAUDE.md**

架構清單加一條(倣既有條目風格):

```markdown
- **策略推薦** `lib/strategy/`:五因子(價值/收息/動能/籌碼/熱度)截面百分位評分,
  資料源=screener 快照+月均價(`STOCK_DAY_AVG_ALL`)+每股法人買賣超(rwd `T86`,不帶 date 取最新),
  `service.getStrategySnapshot()` 10min 快取、月均/T86 失敗對應因子 null(容錯);
  百分位/加權計分為前後端共用純函式(`engine.ts`,評分宇宙 ≥200 張且 ≥5 元、缺因子權重再正規化、<3 因子不進榜),
  前端整包快照下發、調權重即時重排。頁面 `/strategy`,無 DB 表。
```

路線圖「選股延伸」句改為含「策略推薦已上線(2026-07-03)」。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 納入策略推薦(多因子評分)"
```
