# FinMind 整合 M2:基本面(月營收+EPS)+ 策略成長因子 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月營收/季 EPS 進 DB(TWSE OpenAPI 免費源),策略推薦加第六因子「成長」,個股頁加基本面區塊。

**Architecture:** 新表 `MonthlyRevenue`/`QuarterlyEps`(Prisma migration);`lib/ingest/twseFundamentals.ts` 純函式 parser + fetcher;`scripts/ingest-fundamentals.ts` cron 灌入;strategy engine 擴充 `growth` 因子(截面百分位、缺值再正規化沿用);個股頁由 server component 直讀 DB 渲染基本面(不加 API route——頁面本身就是 server component,YAGNI)。

**Tech Stack:** Next.js 16 / TypeScript strict / Prisma(MySQL)/ Vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-nazodex-finmind-integration-design.md`(M2 節)

## Global Constraints

- TDD;vitest 中文 it 描述;`pnpm test` 全綠 + `pnpm exec tsc --noEmit` 通過再 commit。
- 外部 fetch 8s AbortController + `fetchImpl: typeof fetch = fetch` 注入(既有模式)。
- **實測欄位格式(2026-07-09)**:t187ap05_L `資料年月:"11505"`(民國YYYMM)、`營業收入-當月營收:"416975163"`(**千元**)、`營業收入-去年同月增減(%):"30.09498020271696"`;t187ap14_L `年度:"115"`、`季別:"1"`、`基本每股盈餘(元):"22.08"`。
- 日期落 DB:月 → 該月 1 日 UTC(`2026-05-01T00:00:00Z`);季 → 季首日 UTC(Q1=01-01/Q2=04-01/Q3=07-01/Q4=10-01)。
- 兩表資料為「最新一期快照」,歷史靠 cron 累積;首跑不回填歷史。

---

### Task 1: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma`(檔尾加兩個 model)
- Create: `prisma/migrations/XXXX_add_fundamentals/`(由 migrate dev 產生)

**Interfaces:**
- Produces: `prisma.monthlyRevenue` / `prisma.quarterlyEps` client API;欄位如下。

- [ ] **Step 1: schema 加 model**

`prisma/schema.prisma` 檔尾新增:

```prisma
model MonthlyRevenue {
  id          String   @id @default(cuid())
  stockSymbol String
  month       DateTime @db.Date // 該月 1 日(UTC)
  revenue     BigInt   // 當月營收,單位:千元(TWSE t187ap05_L 原始單位)
  yoyPct      Float?   // 去年同月增減%(官方已算好;上市首年無值)
  @@unique([stockSymbol, month])
  @@index([month])
}

model QuarterlyEps {
  id          String   @id @default(cuid())
  stockSymbol String
  quarter     DateTime @db.Date // 季首日(UTC):Q1=01-01/Q2=04-01/Q3=07-01/Q4=10-01
  eps         Float    // 基本每股盈餘(元)
  @@unique([stockSymbol, quarter])
}
```

(不加 Stock relation——基本面涵蓋全上市,含未入 Stock 表的代號也要能存,與 DailyQuote 的 FK 模式刻意不同;查詢一律以 stockSymbol 直查。)

- [ ] **Step 2: 用拋棄式本機 MySQL 產 migration**

```bash
docker run -d --name nazodex-migrate-db -e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=nazodex_dev -p 3311:3306 mysql:8
until docker exec nazodex-migrate-db mysqladmin ping -h localhost -pdev --silent 2>/dev/null; do sleep 2; done
DATABASE_URL="mysql://root:dev@127.0.0.1:3311/nazodex_dev" pnpm exec prisma migrate dev --name add_fundamentals
docker rm -f nazodex-migrate-db
```

Expected: `prisma/migrations/<ts>_add_fundamentals/migration.sql` 產生(兩個 CREATE TABLE),`prisma generate` 自動跑。

- [ ] **Step 3: 驗證**

Run: `pnpm exec tsc --noEmit`;`pnpm test` 全綠(schema 變更不影響既有測試)。

- [ ] **Step 4: Commit**

```bash
git add prisma
git commit -m "feat: MonthlyRevenue/QuarterlyEps 表——月營收(千元+官方YoY)與季EPS,無FK直查設計"
```

---

### Task 2: TWSE 基本面 parser + fetcher

**Files:**
- Create: `lib/ingest/twseFundamentals.ts`
- Test: `lib/ingest/__tests__/twseFundamentals.test.ts`

**Interfaces:**
- Produces:
  - `MonthRevenueRow = { symbol: string; month: string; revenue: bigint; yoyPct: number | null }`(month 為 ISO 該月 1 日,如 `"2026-05-01"`)
  - `parseMonthRevenue(json: unknown): MonthRevenueRow[]`;`fetchMonthRevenue(fetchImpl?): Promise<MonthRevenueRow[]>`(`/v1/opendata/t187ap05_L`)
  - `QuarterEpsRow = { symbol: string; quarter: string; eps: number }`(quarter 為 ISO 季首日,如 `"2026-01-01"`)
  - `parseQuarterlyEps(json: unknown): QuarterEpsRow[]`;`fetchQuarterlyEps(fetchImpl?): Promise<QuarterEpsRow[]>`(`/v1/opendata/t187ap14_L`)

- [ ] **Step 1: 寫失敗測試**

`lib/ingest/__tests__/twseFundamentals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMonthRevenue, parseQuarterlyEps } from "@/lib/ingest/twseFundamentals";

const revenueSample = [
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "2330", 公司名稱: "台積電",
    "營業收入-當月營收": "416975163", "營業收入-去年同月增減(%)": "30.09498020271696" },
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "6547", 公司名稱: "高端疫苗",
    "營業收入-當月營收": "12345", "營業收入-去年同月增減(%)": "" }, // 上市首年無 YoY → null
  { 出表日期: "1150617", 資料年月: "11505", 公司代號: "9999", 公司名稱: "壞資料",
    "營業收入-當月營收": "" }, // 無營收 → 略過
];

describe("parseMonthRevenue", () => {
  it("民國年月轉 ISO 月初、營收 bigint(千元)、官方 YoY;缺 YoY 為 null、缺營收列略過", () => {
    const rows = parseMonthRevenue(revenueSample);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ symbol: "2330", month: "2026-05-01", revenue: 416975163n, yoyPct: 30.09498020271696 });
    expect(rows[1].yoyPct).toBeNull();
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/ingest` → FAIL(模組不存在)

- [ ] **Step 3: 實作**

`lib/ingest/twseFundamentals.ts`:

```ts
type Raw = Record<string, string>;

export type MonthRevenueRow = {
  symbol: string;
  month: string;   // ISO 該月 1 日
  revenue: bigint; // 千元(TWSE 原始單位)
  yoyPct: number | null;
};

export type QuarterEpsRow = {
  symbol: string;
  quarter: string; // ISO 季首日
  eps: number;
};

// 民國 "11505" → "2026-05-01"
function rocYmToIsoMonth(ym: string | undefined): string | null {
  const m = ym?.match(/^(\d{3})(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-01`;
}

function numOrNull(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseMonthRevenue(json: unknown): MonthRevenueRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: MonthRevenueRow[] = [];
  for (const r of arr) {
    const symbol = (r["公司代號"] ?? "").trim();
    const month = rocYmToIsoMonth(r["資料年月"]);
    const revenueStr = (r["營業收入-當月營收"] ?? "").replace(/,/g, "").trim();
    if (!symbol || !month || !/^\d+$/.test(revenueStr)) continue;
    out.push({
      symbol,
      month,
      revenue: BigInt(revenueStr),
      yoyPct: numOrNull(r["營業收入-去年同月增減(%)"]),
    });
  }
  return out;
}

const QUARTER_START: Record<string, string> = { "1": "01-01", "2": "04-01", "3": "07-01", "4": "10-01" };

export function parseQuarterlyEps(json: unknown): QuarterEpsRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: QuarterEpsRow[] = [];
  for (const r of arr) {
    const symbol = (r["公司代號"] ?? "").trim();
    const year = (r["年度"] ?? "").trim();
    const qStart = QUARTER_START[(r["季別"] ?? "").trim()];
    const eps = numOrNull(r["基本每股盈餘(元)"]);
    if (!symbol || !/^\d{3}$/.test(year) || !qStart || eps == null) continue;
    out.push({ symbol, quarter: `${Number(year) + 1911}-${qStart}`, eps });
  }
  return out;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status} (${url})`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMonthRevenue(fetchImpl: typeof fetch = fetch): Promise<MonthRevenueRow[]> {
  return parseMonthRevenue(await fetchJson("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", fetchImpl));
}

export async function fetchQuarterlyEps(fetchImpl: typeof fetch = fetch): Promise<QuarterEpsRow[]> {
  return parseQuarterlyEps(await fetchJson("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", fetchImpl));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/ingest` → PASS;`pnpm test`;`pnpm exec tsc --noEmit`。

- [ ] **Step 5: Commit**

```bash
git add lib/ingest
git commit -m "feat: TWSE 基本面 parser——月營收(民國年月/千元/官方YoY)與季EPS(季別轉季首日)"
```

---

### Task 3: 基本面 ingest 腳本

**Files:**
- Create: `scripts/ingest-fundamentals.ts`
- Modify: `package.json`(scripts 加 `"ingest:fundamentals": "tsx scripts/ingest-fundamentals.ts"`)
- Modify: `Dockerfile`(backfill-finmind 的 esbuild 區塊後,同參數編 `scripts/ingest-fundamentals.ts` → `dist/ingest-fundamentals.mjs`)

**Interfaces:**
- Consumes: `fetchMonthRevenue`/`fetchQuarterlyEps`(Task 2)、`prisma`(Task 1 client)。
- Produces: CLI `pnpm ingest:fundamentals`;兩源獨立容錯(單源失敗只缺該類資料、log 標示;兩源皆敗 exit 1)。

IO 編排,無新單元測試(scripts 慣例);smoke 於 Task 6。

- [ ] **Step 1: 實作**

`scripts/ingest-fundamentals.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { fetchMonthRevenue, fetchQuarterlyEps } from "@/lib/ingest/twseFundamentals";

async function ingestRevenue(): Promise<number> {
  const rows = await fetchMonthRevenue();
  for (const r of rows) {
    const month = new Date(`${r.month}T00:00:00Z`);
    await prisma.monthlyRevenue.upsert({
      where: { stockSymbol_month: { stockSymbol: r.symbol, month } },
      create: { stockSymbol: r.symbol, month, revenue: r.revenue, yoyPct: r.yoyPct },
      update: { revenue: r.revenue, yoyPct: r.yoyPct }, // 公司更正申報時官方值會變,重跑覆寫
    });
  }
  return rows.length;
}

async function ingestEps(): Promise<number> {
  const rows = await fetchQuarterlyEps();
  for (const r of rows) {
    const quarter = new Date(`${r.quarter}T00:00:00Z`);
    await prisma.quarterlyEps.upsert({
      where: { stockSymbol_quarter: { stockSymbol: r.symbol, quarter } },
      create: { stockSymbol: r.symbol, quarter, eps: r.eps },
      update: { eps: r.eps },
    });
  }
  return rows.length;
}

async function main() {
  let okSources = 0;
  try {
    console.log(`月營收: ${await ingestRevenue()} rows`);
    okSources++;
  } catch (e) {
    console.error(`月營收失敗: ${(e as Error).message}`);
  }
  try {
    console.log(`季EPS: ${await ingestEps()} rows`);
    okSources++;
  } catch (e) {
    console.error(`季EPS失敗: ${(e as Error).message}`);
  }
  if (okSources === 0) {
    console.error("兩源皆失敗");
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

`package.json` scripts 加 `"ingest:fundamentals": "tsx scripts/ingest-fundamentals.ts"`。

`Dockerfile` 加(backfill-finmind 區塊後):

```dockerfile
# 基本面(月營收/季EPS)ingest;K8s CronJob 每月 11、16 日跑 `node dist/ingest-fundamentals.mjs`。
RUN pnpm exec esbuild scripts/ingest-fundamentals.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external \
      --outfile=dist/ingest-fundamentals.mjs
```

- [ ] **Step 2: 驗證**

`pnpm exec tsc --noEmit`;`pnpm test`;`pnpm exec esbuild scripts/ingest-fundamentals.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=/tmp/ingest-fundamentals-check.mjs`。

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest-fundamentals.ts package.json Dockerfile
git commit -m "feat: 基本面 ingest 腳本——月營收/季EPS 雙源獨立容錯、upsert 覆寫官方更正"
```

---

### Task 4: 策略第六因子「成長」

**Files:**
- Modify: `lib/strategy/types.ts`(FactorKey 加 `"growth"`;FactorRow 加 `revenueYoyPct: number | null`)
- Modify: `lib/strategy/engine.ts`(FACTOR_KEYS/LABELS、computeFactorScores、reasonText、STRATEGIES 權重、新增「成長飛輪」策略)
- Modify: `lib/strategy/service.ts`(deps 加 revenueYoy fetcher,DB 撈各股最新一期 yoyPct)
- Modify: `lib/strategy/__tests__/*`(既有 fixture 的 Weights/FactorRow 補 growth/revenueYoyPct;新增 growth 計分測試)

**Interfaces:**
- Consumes: `prisma.monthlyRevenue`(Task 1)。
- Produces:
  - `FactorKey = "value" | "dividend" | "momentum" | "chips" | "heat" | "growth"`
  - `FactorRow` 增欄 `revenueYoyPct: number | null`
  - `service.ts`:`fetchLatestRevenueYoy(): Promise<Map<string, number>>`(近 70 天內各 symbol 最新一期的 yoyPct;無資料/失敗 → 空 Map);`StrategyDeps` 加 `revenueYoy?: () => Promise<Map<string, number>>`
  - `buildFactorRows(snap, dayAvg, t86, revenueYoy)` 第四參數

- [ ] **Step 1: 寫失敗測試**

於 `lib/strategy/__tests__/engine.test.ts`(或既有測試檔慣例位置)新增:

```ts
// growth 因子:營收 YoY 截面百分位
it("growth 因子按 revenueYoyPct 百分位計分,缺值為 null", () => {
  const rows = [mkRow({ symbol: "A", revenueYoyPct: 50 }), mkRow({ symbol: "B", revenueYoyPct: -10 }), mkRow({ symbol: "C", revenueYoyPct: null })];
  const scores = computeFactorScores(rows);
  expect(scores[0].growth).toBe(100);
  expect(scores[1].growth).toBe(0);
  expect(scores[2].growth).toBeNull();
});
```

(`mkRow` 為既有測試的 fixture helper——沿用其模式,補上 `revenueYoyPct` 欄位;若無 helper 則依既有 fixture 寫法補欄。)

同檔驗證:所有 `STRATEGIES` 權重含 `growth` 且總和為 1(±1e-9);新策略 `growth`(成長飛輪)存在。
`buildFactorRows` 測試(service 測試檔):傳入 `new Map([["2330", 30.1]])` → 對應列 `revenueYoyPct = 30.1`,未見於 Map 的列為 null。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/strategy` → FAIL(型別/欄位不存在)

- [ ] **Step 3: 實作**

`types.ts`:

```ts
export type FactorRow = ScreenerRow & {
  biasPct: number | null;
  chipsRatio: number | null;
  revenueYoyPct: number | null; // 最新一期月營收年增%(官方值)
};
export type FactorKey = "value" | "dividend" | "momentum" | "chips" | "heat" | "growth";
```

`engine.ts` 變更點:

```ts
export const FACTOR_KEYS: FactorKey[] = ["value", "dividend", "momentum", "chips", "heat", "growth"];
export const FACTOR_LABELS: Record<FactorKey, string> = {
  value: "價值", dividend: "收息", momentum: "動能", chips: "籌碼", heat: "熱度", growth: "成長",
};
// computeFactorScores 內:
const growthHigh = percentileRanks(rows.map((r) => r.revenueYoyPct));
// 回傳物件加 growth: growthHigh[i],
// reasonText 加 case:
case "growth": return `營收年增動能${pctPhrase(score)}`;
// STRATEGIES 全面重配(總和皆為 1):
export const STRATEGIES: StrategyDef[] = [
  { key: "balanced", label: "均衡精選", blurb: "六力平均、體質全面",
    weights: { value: 0.2, dividend: 0.2, momentum: 0.15, chips: 0.15, heat: 0.1, growth: 0.2 } },
  { key: "income", label: "存股收息", blurb: "領股息為主,兼顧不買貴",
    weights: { value: 0.25, dividend: 0.45, momentum: 0.05, chips: 0.1, heat: 0.05, growth: 0.1 } },
  { key: "value", label: "價值獵手", blurb: "便宜是硬道理",
    weights: { value: 0.5, dividend: 0.15, momentum: 0.05, chips: 0.1, heat: 0.05, growth: 0.15 } },
  { key: "momentum", label: "動能突擊", blurb: "順勢而為、量價齊揚",
    weights: { value: 0.05, dividend: 0.05, momentum: 0.4, chips: 0.2, heat: 0.15, growth: 0.15 } },
  { key: "chips", label: "主力同行", blurb: "跟著法人腳步",
    weights: { value: 0.1, dividend: 0.05, momentum: 0.15, chips: 0.5, heat: 0.1, growth: 0.1 } },
  { key: "growth", label: "成長飛輪", blurb: "營收年增領航",
    weights: { value: 0.1, dividend: 0.05, momentum: 0.2, chips: 0.1, heat: 0.05, growth: 0.5 } },
];
```

`service.ts` 變更點:

```ts
import { prisma } from "@/lib/prisma";
// 近 70 天內每檔最新一期 yoyPct(公告時點參差,70 天涵蓋上一期+緩衝);失敗或無資料回空 Map
export async function fetchLatestRevenueYoy(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 70 * 86_400_000);
  const rows = await prisma.monthlyRevenue.findMany({
    where: { month: { gte: since }, yoyPct: { not: null } },
    orderBy: { month: "asc" },
    select: { stockSymbol: true, yoyPct: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.stockSymbol, r.yoyPct!); // asc 順序,後者(較新月份)覆蓋前者
  return map;
}
// StrategyDeps 加 revenueYoy?: () => Promise<Map<string, number>>;
// buildFactorRows 加第四參數 revenueYoy: Map<string, number>,列組裝加:
//   revenueYoyPct: revenueYoy.get(r.symbol) ?? null,
// fetchStrategySnapshot 加:
//   let revenueYoy = new Map<string, number>();
//   try { revenueYoy = await (deps.revenueYoy ?? fetchLatestRevenueYoy)(); } catch { /* 成長因子全 null */ }
```

同步修既有測試 fixture:所有 `Weights` 物件字面值補 `growth: <值>`(維持原測試意圖——原本測哪個因子就讓該因子權重維持主導);`FactorRow`/`buildFactorRows` fixture 補 `revenueYoyPct`。**不可為了過測而改測試斷言語意**;若某測試斷言的榜單順序因新因子改變,優先讓 fixture 的 `revenueYoyPct` 為 null(缺值再正規化,不影響原有相對排序)。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/strategy` → PASS;`pnpm test`;`pnpm exec tsc --noEmit`。
(components/strategy 的測試若有 Weights fixture 也要補 growth——`pnpm test` 全綠為準。)

- [ ] **Step 5: Commit**

```bash
git add lib/strategy components/strategy
git commit -m "feat: 策略第六因子「成長」——營收YoY截面百分位、六策略權重重配、新增成長飛輪"
```

---

### Task 5: 個股頁基本面區塊

**Files:**
- Create: `lib/fundamentals/service.ts`
- Create: `components/stock/FundamentalsSection.tsx`(presentational,server-renderable)
- Modify: `app/stock/[symbol]/page.tsx`(PriceChart 下方渲染)
- Test: `lib/fundamentals/__tests__/service.test.ts`(純函式)+ `components/stock/__tests__/FundamentalsSection.test.tsx`(render 測試,沿用既有 component 測試模式)

**Interfaces:**
- Consumes: `prisma.monthlyRevenue`/`prisma.quarterlyEps`(Task 1)。
- Produces:
  - `RevenuePoint = { month: string; revenueBillions: number; yoyPct: number | null; barPct: number }`(month 顯示格式 `"2026-05"`;revenueBillions = 千元→億元;barPct 0–100 相對最大值)
  - `EpsPoint = { label: string; eps: number }`(label 如 `"2026 Q1"`)
  - `toRevenuePoints(rows: { month: Date; revenue: bigint; yoyPct: number | null }[]): RevenuePoint[]`(純函式,輸入新→舊,輸出舊→新)
  - `toEpsPoints(rows: { quarter: Date; eps: number }[]): EpsPoint[]`(同上)
  - `getFundamentals(symbol: string): Promise<{ revenues: RevenuePoint[]; eps: EpsPoint[] }>`(近 12 月 + 近 8 季;無資料回空陣列)
  - `<FundamentalsSection revenues={...} eps={...} />`:兩者皆空 → 回 null(區塊隱藏)

- [ ] **Step 1: 寫失敗測試**

`lib/fundamentals/__tests__/service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toRevenuePoints, toEpsPoints } from "@/lib/fundamentals/service";

describe("toRevenuePoints", () => {
  it("千元轉億元、相對最大值算 barPct、輸出舊→新", () => {
    const pts = toRevenuePoints([
      { month: new Date("2026-05-01T00:00:00Z"), revenue: 416975163n, yoyPct: 30.09 },
      { month: new Date("2026-04-01T00:00:00Z"), revenue: 208487581n, yoyPct: null },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[0].month).toBe("2026-04"); // 舊→新
    expect(pts[1].revenueBillions).toBeCloseTo(4169.75, 1);
    expect(pts[1].barPct).toBe(100);
    expect(pts[0].barPct).toBeCloseTo(50, 0);
    expect(pts[0].yoyPct).toBeNull();
  });
  it("空輸入回 []", () => {
    expect(toRevenuePoints([])).toEqual([]);
  });
});

describe("toEpsPoints", () => {
  it("季首日轉 label、輸出舊→新", () => {
    const pts = toEpsPoints([
      { quarter: new Date("2026-01-01T00:00:00Z"), eps: 22.08 },
      { quarter: new Date("2025-10-01T00:00:00Z"), eps: 20.5 },
    ]);
    expect(pts[0]).toEqual({ label: "2025 Q4", eps: 20.5 });
    expect(pts[1]).toEqual({ label: "2026 Q1", eps: 22.08 });
  });
});
```

`components/stock/__tests__/FundamentalsSection.test.tsx`(依既有 component 測試模式,如 components/watchlist 的測試):渲染含 12 個月資料 → 出現「月營收」與最新月份文字與 YoY;`revenues=[] eps=[]` → render 結果為空(`container.firstChild` null)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/fundamentals components/stock` → FAIL

- [ ] **Step 3: 實作**

`lib/fundamentals/service.ts`:

```ts
import { prisma } from "@/lib/prisma";

export type RevenuePoint = { month: string; revenueBillions: number; yoyPct: number | null; barPct: number };
export type EpsPoint = { label: string; eps: number };

// 千元 → 億元 = /100,000
export function toRevenuePoints(rows: { month: Date; revenue: bigint; yoyPct: number | null }[]): RevenuePoint[] {
  const asc = [...rows].sort((a, b) => a.month.getTime() - b.month.getTime());
  const billions = asc.map((r) => Number(r.revenue) / 100_000);
  const max = Math.max(...billions, 0);
  return asc.map((r, i) => ({
    month: r.month.toISOString().slice(0, 7),
    revenueBillions: billions[i],
    yoyPct: r.yoyPct,
    barPct: max > 0 ? (billions[i] / max) * 100 : 0,
  }));
}

export function toEpsPoints(rows: { quarter: Date; eps: number }[]): EpsPoint[] {
  return [...rows]
    .sort((a, b) => a.quarter.getTime() - b.quarter.getTime())
    .map((r) => ({
      label: `${r.quarter.getUTCFullYear()} Q${Math.floor(r.quarter.getUTCMonth() / 3) + 1}`,
      eps: r.eps,
    }));
}

export async function getFundamentals(symbol: string): Promise<{ revenues: RevenuePoint[]; eps: EpsPoint[] }> {
  const [rev, eps] = await Promise.all([
    prisma.monthlyRevenue.findMany({ where: { stockSymbol: symbol }, orderBy: { month: "desc" }, take: 12 }),
    prisma.quarterlyEps.findMany({ where: { stockSymbol: symbol }, orderBy: { quarter: "desc" }, take: 8 }),
  ]);
  return { revenues: toRevenuePoints(rev), eps: toEpsPoints(eps) };
}
```

`components/stock/FundamentalsSection.tsx`(無 "use client"——纯展示,server 可渲染):

```tsx
import type { EpsPoint, RevenuePoint } from "@/lib/fundamentals/service";
import { fmtSignedPct } from "@/lib/format";

export default function FundamentalsSection({ revenues, eps }: { revenues: RevenuePoint[]; eps: EpsPoint[] }) {
  if (revenues.length === 0 && eps.length === 0) return null;
  const latest = revenues[revenues.length - 1];
  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">基本面</h2>
      {revenues.length > 0 && (
        <div className="rounded-lg bg-[var(--card)] p-4">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-gray-400">月營收({latest.month})</span>
            <span>
              {latest.revenueBillions >= 10 ? latest.revenueBillions.toFixed(0) : latest.revenueBillions.toFixed(2)} 億
              {latest.yoyPct != null && (
                <span className={`ml-2 text-xs ${latest.yoyPct >= 0 ? "text-up" : "text-down"}`}>
                  年增 {fmtSignedPct(latest.yoyPct)}
                </span>
              )}
            </span>
          </div>
          <div className="flex h-16 items-end gap-1" aria-label="近 12 月營收長條圖">
            {revenues.map((p) => (
              <div key={p.month} className="flex-1" title={`${p.month}:${p.revenueBillions.toFixed(1)} 億`}>
                <div className="w-full rounded-t bg-brand/70" style={{ height: `${Math.max(p.barPct, 2)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>{revenues[0].month}</span>
            <span>{latest.month}</span>
          </div>
        </div>
      )}
      {eps.length > 0 && (
        <div className="rounded-lg bg-[var(--card)] p-4 text-sm">
          <div className="mb-2 text-gray-400">每股盈餘 EPS(元)</div>
          <div className="grid grid-cols-4 gap-2">
            {eps.map((q) => (
              <div key={q.label} className="text-center">
                <div className="text-xs text-gray-500">{q.label}</div>
                <div className={q.eps < 0 ? "text-down" : ""}>{q.eps.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
```

(顏色遵守慣例:漲跌語意用 `text-up`/`text-down`,長條用品牌金 `bg-brand/70`,不寫死 hex。`fmtSignedPct` 若簽名不合改用等價既有 formatter;若無合用者以 `${p>=0?"+":""}${p.toFixed(1)}%` 行內處理並移除 import。)

`app/stock/[symbol]/page.tsx`:

```tsx
import FundamentalsSection from "@/components/stock/FundamentalsSection";
import { getFundamentals } from "@/lib/fundamentals/service";
// StockPage 內 PriceChart 之後:
//   const { revenues, eps } = await getFundamentals(symbol);
//   <FundamentalsSection revenues={revenues} eps={eps} />
// getFundamentals 以 try/catch 包裹,DB 失敗 → 區塊不渲染(頁面其餘照常)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/fundamentals components/stock` → PASS;`pnpm test`;`pnpm exec tsc --noEmit`。

- [ ] **Step 5: Commit**

```bash
git add lib/fundamentals components/stock app/stock
git commit -m "feat: 個股頁基本面區塊——近12月營收長條(億元+官方YoY)與近8季EPS,server 直讀 DB 無新 API"
```

---

### Task 6: 全量驗證 + smoke + 文件

**Files:**
- Modify: `CLAUDE.md`(指令加 ingest:fundamentals;策略推薦節補「成長」因子與資料源;架構節提基本面表)
- Modify: `README.md`(路線圖:FinMind 基本面項標記已上線——實際用 TWSE 源,措辭同步)

- [ ] **Step 1: 全量驗證**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 2: Smoke(controller 執行——需 DB 隧道)**

`pnpm ingest:fundamentals`(經隧道連 prod DB):月營收 ~1000+ rows、季EPS ~1000 rows、exit 0;
DB 抽查 2330 的 MonthlyRevenue/QuarterlyEps;`/stock/2330` 頁面渲染基本面區塊(pnpm build && start 或部署後驗)。

- [ ] **Step 3: 文件 + Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: M2 基本面上線——成長因子/個股頁基本面/ingest:fundamentals 說明"
```
