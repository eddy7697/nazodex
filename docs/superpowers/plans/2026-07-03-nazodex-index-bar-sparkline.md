# 大盤指數列 + 卡片迷你走勢線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自選股首頁頂端顯示大盤/櫃買指數即時列,卡片與表格顯示近月收盤迷你走勢線;附一次性歷史回填腳本讓走勢線上線即可用。

**Architecture:** 指數列重用 `lib/market-overview` 既有 30s 快取;走勢線由 `DailyQuote` batch 查近 30 個交易日收盤,inline SVG 畫 polyline(不用圖表庫);回填腳本以 TWSE rwd `STOCK_DAY`(單股單月)只回填自選+持股股票,節流 1.5s/請求。

**Tech Stack:** Next.js App Router、Prisma(MySQL)、Vitest + @testing-library/react(jsdom)、esbuild(script 打包)。

## Global Constraints

- **紅漲綠跌**:顏色一律經 `lib/format.ts` 的 `changeColorClass`(`text-up`/`text-down`/`text-gray-400`)或 CSS 變數 `--up`/`--down`;元件不得寫死 hex。
- 價格顯示用 `fmtPrice`,漲跌幅用 `fmtSignedPct`(皆在 `lib/format.ts`)。
- 所有 API route 都要 `auth()` 檢查 session,未登入回 401(比照既有 route)。
- 自選相關查詢一律以 session userId 過濾,不接受 client 指定 symbols。
- TypeScript strict;TDD:先寫失敗測試。
- 測試指令:`pnpm test`(vitest run);型別:`pnpm exec tsc --noEmit`。
- Commit message 中文,結尾加:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 與
  `Claude-Session: https://claude.ai/code/session_013RHuxFFs8RjjA8A6rui3Q4`

---

### Task 1: `lib/sparkline.ts` 純函式

**Files:**
- Create: `lib/sparkline.ts`
- Test: `lib/__tests__/sparkline.test.ts`

**Interfaces:**
- Produces: `sparklinePoints(closes: number[], width: number, height: number, pad?: number): string` — SVG polyline `points` 字串;`closes.length < 2` 回 `""`;全平序列畫 `height/2` 水平線。Task 5 的 `Sparkline` 元件使用。

- [ ] **Step 1: 寫失敗測試** `lib/__tests__/sparkline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sparklinePoints } from "@/lib/sparkline";

describe("sparklinePoints", () => {
  it("少於 2 點回空字串", () => {
    expect(sparklinePoints([], 64, 24)).toBe("");
    expect(sparklinePoints([100], 64, 24)).toBe("");
  });

  it("遞增序列:第一點在左下、最後一點在右上(pad=2)", () => {
    const pts = sparklinePoints([1, 3], 64, 24, 2);
    expect(pts).toBe("2,22 62,2");
  });

  it("全平序列畫置中水平線", () => {
    const pts = sparklinePoints([10, 10, 10], 60, 24, 2);
    expect(pts.split(" ").every((p) => p.endsWith(",12"))).toBe(true);
  });

  it("點數與輸入相同、x 均分", () => {
    const pts = sparklinePoints([1, 2, 1, 4, 3], 102, 24, 1);
    const xs = pts.split(" ").map((p) => Number(p.split(",")[0]));
    expect(xs).toEqual([1, 26, 51, 76, 101]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/__tests__/sparkline.test.ts`
Expected: FAIL(找不到 `@/lib/sparkline`)

- [ ] **Step 3: 最小實作** `lib/sparkline.ts`:

```ts
// 把收盤序列 normalize 成 SVG polyline 的 points 字串(左舊右新)。
// <2 點回空字串(畫不成線);全平序列以 height/2 畫置中水平線。
export function sparklinePoints(closes: number[], width: number, height: number, pad = 2): string {
  if (closes.length < 2) return "";
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;
  const step = (width - pad * 2) / (closes.length - 1);
  const innerH = height - pad * 2;
  return closes
    .map((c, i) => {
      const x = round2(pad + i * step);
      const y = span === 0 ? height / 2 : round2(pad + (1 - (c - min) / span) * innerH);
      return `${x},${y}`;
    })
    .join(" ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/__tests__/sparkline.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sparkline.ts lib/__tests__/sparkline.test.ts
git commit -m "feat: sparklinePoints 純函式(收盤序列→SVG polyline 座標)"
```

---

### Task 2: `getSparklines` 服務 + `/api/watchlist/sparklines` route

**Files:**
- Modify: `lib/stocks/history.ts`(檔尾追加函式)
- Create: `app/api/watchlist/sparklines/route.ts`
- Test: `lib/stocks/__tests__/history.test.ts`(追加 describe)

**Interfaces:**
- Consumes: `lib/watchlist/service.ts` 既有 `listWatchlist(userId)`(回 `{ stockSymbol: string; ... }[]`)。
- Produces: `getSparklines(symbols: string[], days?: number, p?): Promise<Record<string, number[]>>` — 每檔近 `days`(預設 30)個交易日收盤、日期升冪;無資料的 symbol 不出現在結果。API 回 `{ sparklines: Record<string, number[]> }`。

- [ ] **Step 1: 在 `lib/stocks/__tests__/history.test.ts` 追加失敗測試**(保留既有內容;把檔頭既有 `import { getHistory } from "@/lib/stocks/history";` 改為 `import { getHistory, getSparklines } from "@/lib/stocks/history";`,再於檔尾加):

```ts
function mockBatch(rows: any[]) {
  return {
    dailyQuote: {
      findMany: async ({ where }: any) => {
        return rows
          .filter((x) => where.stockSymbol.in.includes(x.stockSymbol))
          .sort((a, b) => b.date.getTime() - a.date.getTime());
      },
    },
  } as any;
}

describe("getSparklines", () => {
  const rows = [
    { stockSymbol: "2330", date: new Date("2026-06-30"), close: 1070 },
    { stockSymbol: "2330", date: new Date("2026-07-01"), close: 1085 },
    { stockSymbol: "2330", date: new Date("2026-07-02"), close: 1090 },
    { stockSymbol: "0050", date: new Date("2026-07-02"), close: 205 },
  ];

  it("依 symbol 分組、收盤日期升冪", async () => {
    const s = await getSparklines(["2330", "0050"], 30, mockBatch(rows));
    expect(s["2330"]).toEqual([1070, 1085, 1090]);
    expect(s["0050"]).toEqual([205]);
  });

  it("每檔最多取最近 days 筆", async () => {
    const s = await getSparklines(["2330"], 2, mockBatch(rows));
    expect(s["2330"]).toEqual([1085, 1090]);
  });

  it("無資料的 symbol 不出現;空清單回空物件", async () => {
    const s = await getSparklines(["9999"], 30, mockBatch(rows));
    expect(s["9999"]).toBeUndefined();
    expect(await getSparklines([], 30, mockBatch(rows))).toEqual({});
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/stocks/__tests__/history.test.ts`
Expected: FAIL(`getSparklines` 未匯出)

- [ ] **Step 3: 實作** — `lib/stocks/history.ts` 檔尾追加:

```ts
// 批次取多檔近 days 個交易日收盤(升冪),給自選清單迷你走勢線。
// 不設 take:資料量 = 檔數 × 累積交易日,目前規模(數十檔 × 數月)可整批撈再截斷。
export async function getSparklines(
  symbols: string[],
  days = 30,
  p: P = defaultPrisma,
): Promise<Record<string, number[]>> {
  if (symbols.length === 0) return {};
  const rows = await p.dailyQuote.findMany({
    where: { stockSymbol: { in: symbols } },
    orderBy: { date: "desc" },
    select: { stockSymbol: true, date: true, close: true },
  });
  const bySymbol: Record<string, number[]> = {};
  for (const r of rows as { stockSymbol: string; close: number }[]) {
    const list = (bySymbol[r.stockSymbol] ??= []);
    if (list.length < days) list.push(r.close); // desc:先收到的是最新
  }
  for (const s of Object.keys(bySymbol)) bySymbol[s].reverse(); // 轉升冪
  return bySymbol;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/stocks/__tests__/history.test.ts`
Expected: PASS(既有 getHistory 測試 + 新增 3 tests)

- [ ] **Step 5: 建 route** `app/api/watchlist/sparklines/route.ts`(比照既有 route,薄層不另寫單測;symbols 一律取自 session 使用者的自選,維持隔離):

```ts
import { auth } from "@/auth";
import { listWatchlist } from "@/lib/watchlist/service";
import { getSparklines } from "@/lib/stocks/history";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const items = await listWatchlist(session.user.id);
  const sparklines = await getSparklines(items.map((i) => i.stockSymbol));
  return Response.json({ sparklines });
}
```

- [ ] **Step 6: 型別檢查 + 全測試**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全綠

- [ ] **Step 7: Commit**

```bash
git add lib/stocks/history.ts lib/stocks/__tests__/history.test.ts app/api/watchlist/sparklines/route.ts
git commit -m "feat: 自選走勢線資料——getSparklines batch 查詢 + /api/watchlist/sparklines"
```

---

### Task 3: `getIndices` 服務 + `/api/market/indices` route

**Files:**
- Modify: `lib/market-overview/service.ts`
- Create: `app/api/market/indices/route.ts`
- Test: `lib/market-overview/__tests__/service.test.ts`(追加 describe)

**Interfaces:**
- Consumes: `service.ts` 模組內既有 `cachedIndices`(30s memoize)與 `orNull`、`OverviewDeps`。
- Produces: `getIndices(deps?: OverviewDeps): Promise<Quote[]>` — 成功回指數 Quote 陣列,失敗回 `[]`。API 回 `{ indices: Quote[] }`。Task 6 的 `IndexBar` 打這支 API。

- [ ] **Step 1: 在 `lib/market-overview/__tests__/service.test.ts` 追加失敗測試**(沿用該檔既有 mock 風格;檔尾加):

```ts
import { getIndices } from "@/lib/market-overview/service";

describe("getIndices", () => {
  const q = (symbol: string): any => ({ symbol, name: symbol, price: 1, change: 0, changePct: 0, volume: 0, asOf: "x" });

  it("回傳注入的指數", async () => {
    const indices = await getIndices({ indices: async () => [q("t00"), q("o00")] });
    expect(indices.map((i: any) => i.symbol)).toEqual(["t00", "o00"]);
  });

  it("上游失敗回空陣列", async () => {
    const indices = await getIndices({ indices: async () => { throw new Error("boom"); } });
    expect(indices).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/market-overview/__tests__/service.test.ts`
Expected: FAIL(`getIndices` 未匯出)

- [ ] **Step 3: 實作** — `lib/market-overview/service.ts` 檔尾追加(重用同一份 `cachedIndices`,與 `/market` 共享 30s 快取):

```ts
// 首頁指數列輕量入口:只取指數,與 getMarketOverview 共享 cachedIndices 快取。
export async function getIndices(deps: OverviewDeps = {}): Promise<Quote[]> {
  return (await orNull(deps.indices ?? (() => cachedIndices("indices")))) ?? [];
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/market-overview/__tests__/service.test.ts`
Expected: PASS

- [ ] **Step 5: 建 route** `app/api/market/indices/route.ts`:

```ts
import { auth } from "@/auth";
import { getIndices } from "@/lib/market-overview/service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return Response.json({ indices: await getIndices() });
}
```

- [ ] **Step 6: 型別檢查 + 全測試**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全綠

- [ ] **Step 7: Commit**

```bash
git add lib/market-overview/service.ts lib/market-overview/__tests__/service.test.ts app/api/market/indices/route.ts
git commit -m "feat: getIndices 服務 + /api/market/indices(重用 30s 指數快取)"
```

---

### Task 4: `Sparkline` 元件

**Files:**
- Create: `components/watchlist/Sparkline.tsx`
- Test: `components/watchlist/__tests__/Sparkline.test.tsx`

**Interfaces:**
- Consumes: Task 1 `sparklinePoints`、`lib/format.ts` `changeColorClass`。
- Produces: `<Sparkline closes?: number[] width?: number height?: number />` — `closes` 少於 2 點 render `null`;顏色依窗口首尾差:漲 `text-up`、跌 `text-down`、平 `text-gray-400`(`stroke="currentColor"`,不寫死 hex)。Task 5 使用。

- [ ] **Step 1: 寫失敗測試** `components/watchlist/__tests__/Sparkline.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Sparkline from "@/components/watchlist/Sparkline";

describe("Sparkline", () => {
  it("窗口上漲用 up 色、下跌用 down 色", () => {
    const up = render(<Sparkline closes={[100, 98, 105]} />);
    expect(up.container.querySelector("svg")!.getAttribute("class")).toContain("text-up");
    const down = render(<Sparkline closes={[105, 98, 100]} />);
    expect(down.container.querySelector("svg")!.getAttribute("class")).toContain("text-down");
  });

  it("polyline 用 currentColor(不寫死色碼)", () => {
    const { container } = render(<Sparkline closes={[1, 2]} />);
    expect(container.querySelector("polyline")!.getAttribute("stroke")).toBe("currentColor");
  });

  it("少於 2 點不渲染", () => {
    expect(render(<Sparkline closes={[100]} />).container.firstChild).toBeNull();
    expect(render(<Sparkline />).container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run components/watchlist/__tests__/Sparkline.test.tsx`
Expected: FAIL(找不到元件)

- [ ] **Step 3: 實作** `components/watchlist/Sparkline.tsx`:

```tsx
import { sparklinePoints } from "@/lib/sparkline";
import { changeColorClass } from "@/lib/format";

// 近月收盤迷你走勢線。顏色依「窗口首尾」漲跌(非當日漲跌),經 changeColorClass
// 套 text-up/text-down,線色用 currentColor 繼承,遵守不寫死 hex 的慣例。
export default function Sparkline({
  closes, width = 64, height = 24,
}: { closes?: number[]; width?: number; height?: number }) {
  const data = closes ?? [];
  const points = sparklinePoints(data, width, height);
  if (!points) return null;
  const trend = data[data.length - 1] - data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true" className={`shrink-0 ${changeColorClass(trend)}`}>
      <polyline points={points} fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run components/watchlist/__tests__/Sparkline.test.tsx`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/watchlist/Sparkline.tsx components/watchlist/__tests__/Sparkline.test.tsx
git commit -m "feat: Sparkline 迷你走勢線元件(inline SVG,紅漲綠跌 currentColor)"
```

---

### Task 5: 走勢線接進卡片、表格與 WatchlistView

**Files:**
- Modify: `components/watchlist/QuoteCard.tsx`
- Modify: `components/watchlist/QuoteRow.tsx`
- Modify: `components/watchlist/WatchlistView.tsx`
- Test: `components/watchlist/__tests__/QuoteCard.test.tsx`(追加案例)

**Interfaces:**
- Consumes: Task 2 API `GET /api/watchlist/sparklines` → `{ sparklines: Record<string, number[]> }`;Task 4 `Sparkline`。
- Produces: `QuoteCard`/`QuoteRow` 新增選填 prop `closes?: number[]`(未給時外觀同現狀)。

- [ ] **Step 1: 在 `QuoteCard.test.tsx` 追加失敗測試**(檔尾 describe 內加,或新 describe):

```tsx
  it("有 closes 時渲染走勢線,沒有則無 svg", () => {
    const quote = { symbol: "2330", name: "台積電", price: 1085, change: 15, changePct: 1.4, volume: 21000, asOf: "x" };
    const withLine = render(<QuoteCard quote={quote} onRemove={() => {}} closes={[1000, 1085]} />);
    expect(withLine.container.querySelector("svg")).toBeTruthy();
    const without = render(<QuoteCard quote={quote} onRemove={() => {}} />);
    expect(without.container.querySelector("svg")).toBeNull();
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run components/watchlist/__tests__/QuoteCard.test.tsx`
Expected: FAIL(QuoteCard 無 `closes` prop / 無 svg)

- [ ] **Step 3: 改 `QuoteCard.tsx`** — props 加 `closes?: number[]`,在 `<Link>` 與價格區塊之間插入走勢線:

```tsx
"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import Sparkline from "@/components/watchlist/Sparkline";

export default function QuoteCard({
  quote, onRemove, dragHandle, cardRef, style, closes,
}: {
  quote: Quote;
  onRemove: (s: string) => void;
  dragHandle?: React.ReactNode;
  cardRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  closes?: number[];
}) {
  const c = changeColorClass(quote.change);
  return (
    <div ref={cardRef} style={style} className="flex items-center justify-between rounded-lg bg-[var(--card)] p-4">
      {dragHandle}
      <Link href={`/stock/${quote.symbol}`} className="flex-1">
        <div className="font-bold">{quote.name}</div>
        <div className="text-xs text-gray-400">{quote.symbol}</div>
      </Link>
      <Sparkline closes={closes} />
      <div className="ml-3 text-right">
        <div className={`text-xl font-bold ${c}`}>{fmtPrice(quote.price)}</div>
        <div className="text-sm">
          <span className={c}>{quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : ""}</span>{" "}
          <span className={c}>{fmtSignedPct(quote.changePct)}</span>
        </div>
      </div>
      <button onClick={() => onRemove(quote.symbol)} className="ml-3 text-gray-500" aria-label="移除">✕</button>
    </div>
  );
}
```

- [ ] **Step 4: 改 `QuoteRow.tsx`** — props 加 `closes?: number[]`,「名稱」後新增「近月」欄(寬 80):

```tsx
"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import Sparkline from "@/components/watchlist/Sparkline";

export default function QuoteRow({
  quote, onRemove, dragHandle, rowRef, style, closes,
}: {
  quote: Quote;
  onRemove: (s: string) => void;
  dragHandle?: React.ReactNode;
  rowRef?: React.Ref<HTMLTableRowElement>;
  style?: React.CSSProperties;
  closes?: number[];
}) {
  const c = changeColorClass(quote.change);
  return (
    <tr ref={rowRef} style={style} className="border-b border-white/5 bg-[var(--bg)]">
      <td className="py-2">
        <span className="flex items-center">
          {dragHandle}
          <Link href={`/stock/${quote.symbol}`}>{quote.name}<span className="ml-2 text-xs text-gray-400">{quote.symbol}</span></Link>
        </span>
      </td>
      <td className="py-2"><Sparkline closes={closes} width={80} /></td>
      <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(quote.price)}</td>
      <td className={`py-2 text-right ${c}`}>{fmtSignedPct(quote.changePct)}</td>
      <td className="py-2 text-right text-gray-400">{quote.volume.toLocaleString()}</td>
      <td className="py-2 text-right"><button onClick={() => onRemove(quote.symbol)} className="text-gray-500" aria-label="移除">✕</button></td>
    </tr>
  );
}
```

- [ ] **Step 5: 改 `WatchlistView.tsx`** — 加 sparklines state(mount 抓一次、清單增刪後再抓;每日資料不需 60s 輪詢),表頭加「近月」欄,prop 下傳。逐一修改:

在 `SortableCard` / `SortableRow` 簽名與 JSX 傳遞 `closes`:

```tsx
function SortableCard({ quote, closes, onRemove }: { quote: Quote; closes?: number[]; onRemove: (s: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: quote.symbol });
  return (
    <QuoteCard quote={quote} closes={closes} onRemove={onRemove} cardRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      dragHandle={<DragHandle listeners={listeners} attributes={attributes} />} />
  );
}

function SortableRow({ quote, closes, onRemove }: { quote: Quote; closes?: number[]; onRemove: (s: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: quote.symbol });
  return (
    <QuoteRow quote={quote} closes={closes} onRemove={onRemove} rowRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      dragHandle={<DragHandle listeners={listeners} attributes={attributes} />} />
  );
}
```

`WatchlistView` 本體:

```tsx
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});

  const loadSparklines = useCallback(async () => {
    const res = await fetch("/api/watchlist/sparklines");
    if (!res.ok) return; // 失敗:不畫線,其餘照常
    const json = await res.json();
    setSparklines(json.sparklines ?? {});
  }, []);

  useEffect(() => {
    loadSparklines(); // 每日資料,mount 抓一次即可
  }, [loadSparklines]);
```

`remove()` 成功後與 `AddStock onAdded` 一併刷新:

```tsx
  async function remove(symbol: string) {
    await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
    load();
    loadSparklines();
  }
```

```tsx
      <AddStock onAdded={() => { load(); loadSparklines(); }} />
```

表頭(桌機)在「名稱」後加「近月」:

```tsx
              <tr><th>名稱</th><th>近月</th><th className="text-right">成交</th><th className="text-right">漲跌幅</th><th className="text-right">量(張)</th><th></th></tr>
```

渲染處傳 `closes`:

```tsx
            {quotes.map((q) => <SortableCard key={q.symbol} quote={q} closes={sparklines[q.symbol]} onRemove={remove} />)}
```

```tsx
              {quotes.map((q) => <SortableRow key={q.symbol} quote={q} closes={sparklines[q.symbol]} onRemove={remove} />)}
```

- [ ] **Step 6: 型別檢查 + 全測試**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全綠(既有 QuoteCard 測試不受選填 prop 影響)

- [ ] **Step 7: Commit**

```bash
git add components/watchlist/QuoteCard.tsx components/watchlist/QuoteRow.tsx components/watchlist/WatchlistView.tsx components/watchlist/__tests__/QuoteCard.test.tsx
git commit -m "feat: 自選卡片/表格接上近月迷你走勢線"
```

---

### Task 6: `IndexBar` 元件 + 首頁掛載

**Files:**
- Create: `components/watchlist/IndexBar.tsx`
- Modify: `app/page.tsx`
- Test: `components/watchlist/__tests__/IndexBar.test.tsx`

**Interfaces:**
- Consumes: Task 3 API `GET /api/market/indices` → `{ indices: Quote[] }`。
- Produces: `<IndexBar />`(無 props);無資料/失敗時 render `null`。

- [ ] **Step 1: 寫失敗測試** `components/watchlist/__tests__/IndexBar.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import IndexBar from "@/components/watchlist/IndexBar";

afterEach(() => vi.unstubAllGlobals());

describe("IndexBar", () => {
  it("顯示指數名稱、點位與紅漲綠跌", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ indices: [
        { symbol: "t00", name: "加權指數", price: 23456.78, change: 123.4, changePct: 0.53, volume: 0, asOf: "x" },
        { symbol: "o00", name: "櫃買指數", price: 260.12, change: -1.2, changePct: -0.46, volume: 0, asOf: "x" },
      ] }),
    })));
    render(<IndexBar />);
    await waitFor(() => expect(screen.getByText("加權指數")).toBeTruthy());
    expect(screen.getByText("23,456.78").className).toContain("text-up");
    expect(screen.getByText("-0.46%").className).toContain("text-down");
  });

  it("API 失敗時整列隱藏", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const { container } = render(<IndexBar />);
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0));
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run components/watchlist/__tests__/IndexBar.test.tsx`
Expected: FAIL(找不到元件)

- [ ] **Step 3: 實作** `components/watchlist/IndexBar.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

// 首頁頂端大盤指數列。取不到資料整列隱藏,不擋看盤;點擊進 /market。
export default function IndexBar() {
  const [indices, setIndices] = useState<Quote[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/market/indices");
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setIndices(json.indices ?? []);
      } catch {
        // 失敗維持現狀(初始為空 → 隱藏)
      }
    };
    load();
    const id = setInterval(load, 60_000); // 與自選報價同頻
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (indices.length === 0) return null;
  return (
    <Link href="/market" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[var(--card)] px-4 py-2 text-sm">
      {indices.map((q) => (
        <span key={q.symbol} className="flex items-baseline gap-2">
          <span className="text-gray-400">{q.name}</span>
          <span className={`font-bold ${changeColorClass(q.change)}`}>{fmtPrice(q.price)}</span>
          <span className={changeColorClass(q.change)}>{fmtSignedPct(q.changePct)}</span>
        </span>
      ))}
    </Link>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run components/watchlist/__tests__/IndexBar.test.tsx`
Expected: PASS(2 tests)

- [ ] **Step 5: 掛上首頁** — `app/page.tsx`:

```tsx
import AppShell from "@/components/layout/AppShell";
import IndexBar from "@/components/watchlist/IndexBar";
import WatchlistView from "@/components/watchlist/WatchlistView";
export default function Home() {
  return (
    <AppShell title="台股看板">
      <IndexBar />
      <WatchlistView />
    </AppShell>
  );
}
```

- [ ] **Step 6: 型別檢查 + 全測試**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全綠

- [ ] **Step 7: Commit**

```bash
git add components/watchlist/IndexBar.tsx components/watchlist/__tests__/IndexBar.test.tsx app/page.tsx
git commit -m "feat: 首頁大盤指數列(加權/櫃買,60s 輪詢,點擊進 /market)"
```

---

### Task 7: TWSE `STOCK_DAY` 解析層

**Files:**
- Create: `lib/ingest/twseStockDay.ts`
- Test: `lib/ingest/__tests__/twseStockDay.test.ts`

**Interfaces:**
- Produces:
  - `parseStockDay(json: unknown): StockDayRow[]`,`StockDayRow = { date: string; open: number; high: number; low: number; close: number; volume: number }`(date 為 ISO `YYYY-MM-DD`;volume 單位「股」,與 ingest 一致)。
  - `fetchStockDayMonth(symbol: string, yyyymm01: string, fetchImpl?): Promise<StockDayRow[]>`。
  Task 8 的回填腳本使用。

**背景:** TWSE rwd `STOCK_DAY` 回 `{ stat: "OK", data: [[日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌價差, 成交筆數], ...] }`;日期民國斜線格式 `115/06/02`,數字帶千分位,停牌以 `--` 表示。`stat !== "OK"`(如查無資料月份)回空陣列。

- [ ] **Step 1: 寫失敗測試** `lib/ingest/__tests__/twseStockDay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStockDay } from "@/lib/ingest/twseStockDay";

const ok = {
  stat: "OK",
  data: [
    ["115/06/02", "21,282,758", "20,948,377,347", "984.00", "990.00", "980.00", "988.00", "+4.00", "23,417"],
    ["115/06/03", "18,000,000", "17,800,000,000", "--", "--", "--", "--", " ", "0"],
    ["115/06/04", "30,111,222", "29,000,000,000", "990.00", "1,005.00", "989.00", "1,000.00", "+12.00", "30,000"],
  ],
};

describe("parseStockDay", () => {
  it("民國日期轉 ISO、千分位轉數字、volume 為股數", () => {
    const rows = parseStockDay(ok);
    expect(rows[0]).toEqual({
      date: "2026-06-02", open: 984, high: 990, low: 980, close: 988, volume: 21_282_758,
    });
    expect(rows[1].close).toBe(1000); // "--" 列被跳過,下一筆補位
    expect(rows).toHaveLength(2);
  });

  it("千分位價格正確解析", () => {
    expect(parseStockDay(ok)[1].high).toBe(1005);
  });

  it("stat 非 OK 或格式不對回空陣列", () => {
    expect(parseStockDay({ stat: "很抱歉,沒有符合條件的資料!" })).toEqual([]);
    expect(parseStockDay(null)).toEqual([]);
    expect(parseStockDay({ stat: "OK" })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run lib/ingest/__tests__/twseStockDay.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作** `lib/ingest/twseStockDay.ts`(比照 `twseOpenApi.ts` 的 timeout / parser 風格):

```ts
export type StockDayRow = {
  date: string;   // ISO YYYY-MM-DD
  open: number; high: number; low: number; close: number;
  volume: number; // 股(與每日 ingest 相同單位,顯示層才換算張)
};

// 民國 "115/06/02" → "2026-06-02"
function rocSlashToIso(d: string | undefined): string | null {
  const m = d?.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// STOCK_DAY data 列:[日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌價差, 成交筆數]
export function parseStockDay(json: unknown): StockDayRow[] {
  const j = json as { stat?: string; data?: unknown } | null;
  if (j?.stat !== "OK" || !Array.isArray(j.data)) return [];
  const out: StockDayRow[] = [];
  for (const row of j.data as string[][]) {
    const date = rocSlashToIso(row[0]);
    const close = num(row[6]);
    if (!date || close == null) continue; // 停牌/無效列跳過
    out.push({
      date,
      open: num(row[3]) ?? close,
      high: num(row[4]) ?? close,
      low: num(row[5]) ?? close,
      close,
      volume: num(row[1]) ?? 0,
    });
  }
  return out;
}

// 單股單月日線。yyyymm01 形如 "20260601"(TWSE 以任一當月日期代表整月)。
export async function fetchStockDayMonth(
  symbol: string,
  yyyymm01: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockDayRow[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${yyyymm01}&stockNo=${symbol}&response=json`;
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TWSE STOCK_DAY failed: ${res.status} (${symbol} ${yyyymm01})`);
    return parseStockDay(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run lib/ingest/__tests__/twseStockDay.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/twseStockDay.ts lib/ingest/__tests__/twseStockDay.test.ts
git commit -m "feat: TWSE STOCK_DAY 單股月日線解析層(民國日期/千分位/停牌列)"
```

---

### Task 8: 回填腳本 + 打包

**Files:**
- Create: `scripts/backfill-history.ts`
- Modify: `package.json`(scripts 加一行)
- Modify: `Dockerfile`(esbuild 步驟追加 outfile)

**Interfaces:**
- Consumes: Task 7 `fetchStockDayMonth`;Prisma `watchlistItem`/`holdingTransaction`/`dailyQuote`。
- Produces: `pnpm backfill:history [--months=N]`(預設 2);image 內 `node dist/backfill-history.mjs`。

- [ ] **Step 1: 寫腳本** `scripts/backfill-history.ts`(薄殼,邏輯都在已測的解析層;比照 `ingest-daily.ts` 風格):

```ts
import { prisma } from "@/lib/prisma";
import { fetchStockDayMonth } from "@/lib/ingest/twseStockDay";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 近 months 個月的月初日期參數(YYYYMM01),由當月往回。
function monthParams(months: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}01`);
  }
  return out;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--months="));
  const months = Math.max(1, Number(arg?.split("=")[1]) || 2);

  // 只回填會顯示走勢線的股票:自選 ∪ 持股。
  const [watch, held] = await Promise.all([
    prisma.watchlistItem.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
    prisma.holdingTransaction.findMany({ distinct: ["stockSymbol"], select: { stockSymbol: true } }),
  ]);
  const symbols = [...new Set([...watch, ...held].map((r) => r.stockSymbol))].sort();
  console.log(`backfill ${symbols.length} symbols x ${months} months`);

  const failures: string[] = [];
  let rowsDone = 0;
  for (const symbol of symbols) {
    for (const month of monthParams(months)) {
      try {
        const rows = await fetchStockDayMonth(symbol, month);
        for (const r of rows) {
          const date = new Date(`${r.date}T00:00:00Z`); // UTC 午夜,與每日 ingest(pod UTC)一致
          await prisma.dailyQuote.upsert({
            where: { stockSymbol_date: { stockSymbol: symbol, date } },
            create: {
              stockSymbol: symbol, date,
              open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
            },
            update: {}, // 既有資料(每日 ingest)不覆蓋
          });
          rowsDone++;
        }
        console.log(`${symbol} ${month}: ${rows.length} rows`);
      } catch (e) {
        failures.push(`${symbol} ${month}: ${(e as Error).message}`);
      }
      await sleep(1500); // TWSE 節流,避免高頻被封
    }
  }
  console.log(`done, ${rowsDone} rows processed`);
  if (failures.length) {
    console.error(`failures (${failures.length}):\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: `package.json` scripts 追加**(`"ingest:daily"` 行後):

```json
    "backfill:history": "tsx scripts/backfill-history.ts"
```

- [ ] **Step 3: Dockerfile esbuild 步驟後追加第二個 bundle**(緊接既有 `RUN pnpm exec esbuild scripts/ingest-daily.ts ...` 之後):

```dockerfile
# One-off history backfill (watchlist/holdings symbols only); run manually in a
# pod via `node dist/backfill-history.mjs` after deploy. Same bundling rationale
# as ingest-daily above.
RUN pnpm exec esbuild scripts/backfill-history.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external \
      --outfile=dist/backfill-history.mjs
```

- [ ] **Step 4: 驗證**(本機無 DB,驗證到「連線失敗」即代表腳本本身可執行;另驗證 esbuild 可打包)

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全綠

Run: `pnpm exec esbuild scripts/backfill-history.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=/tmp/claude-1000/-home-eddy-nazodex/b5b68970-0aaf-47af-9b3a-c299994bc4c9/scratchpad/backfill-history.mjs`
Expected: 成功產出 bundle(無錯誤)

Run: `pnpm backfill:history 2>&1 | head -5`
Expected: 到 Prisma 連線才失敗(Authentication failed / can't reach),代表參數解析與載入正常

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-history.ts package.json Dockerfile
git commit -m "feat: 歷史回填腳本(自選∪持股,TWSE STOCK_DAY 近 N 月,節流冪等)"
```

---

### Task 9: 全面驗證 + 文件收尾

**Files:**
- Modify: `CLAUDE.md`(polish 清單、測試數、模組說明)

- [ ] **Step 1: 全套驗證**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: 測試全綠(92 + 新增 ≈ 15 筆)、無型別錯誤、build 成功

- [ ] **Step 2: 更新 `CLAUDE.md`**
  - 測試數字改為實際值(跑完 Step 1 以輸出為準)。
  - 路線圖末段:

```markdown
v1 polish 全數完成(2026-07-03):拖曳排序、盤後標示、成交量統一、AddStock debounce、選股一鍵加自選、大盤指數列(首頁,`/api/market/indices`)+ 卡片迷你走勢線(近月收盤,`/api/watchlist/sparklines`;歷史以 `pnpm backfill:history` 回填自選∪持股近 2 月,新自選靠每日 ingest 累積)。
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-07-03-nazodex-index-bar-sparkline.md
git commit -m "docs: CLAUDE.md 納入指數列與迷你走勢線,v1 polish 全數完成"
```

---

## 部署與上線驗證(計畫執行完、程式碼收尾後)

1. 於 `~/devsecops-nazo` 跑 `bash kubernetes/tenants/nazodex/build-update.sh`(build+push image + rollout)。
2. Rollout 完成後,在 app pod 跑一次回填:
   `kubectl -n nazodex exec deploy/<deployment 名稱> -- node dist/backfill-history.mjs`
   (deployment 名稱以 `kubectl -n nazodex get deploy` 為準;確認 log 出現 `done, N rows processed` 且無 failures。)
3. E2E:以既有 local-E2E JWT 手法或實機開 `https://nazodex.nazo.com.tw/` 驗證:
   - 首頁頂端出現加權/櫃買指數列,顏色紅漲綠跌,點擊導向 `/market`。
   - 自選卡片(手機寬度)與表格(桌機寬度)出現近月走勢線。
   - 走勢線顏色與近月趨勢一致;無資料檔(若有)不畫線且版面正常。
