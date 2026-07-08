# NazoDex 台股看板(看盤 / 自選股)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個 LINE 登入、每人各自維護自選股、盤中每分鐘更新報價、手機 / 電腦皆可用的台股看盤網站,並容器化部署到 GKE。

**Architecture:** 單體 Next.js(App Router)全端應用,同時提供前端 UI 與後端 API;連既有 Cloud SQL MySQL 8(Prisma ORM);報價經後端 `quote-service` 抽象層統一供給(盤中打證交所 MIS + 短快取,盤後回 DB 收盤價);一支 K8s CronJob 每日收盤後把當日行情入庫。

**Tech Stack:** Next.js(App Router)+ TypeScript + Tailwind CSS + Prisma + MySQL 8 + NextAuth v5(Auth.js, LINE provider)+ Vitest(測試)+ lightweight-charts(K 線)。部署:Docker + GKE(Deployment + CronJob)。

## Global Constraints

- 執行環境:Node.js 20+;Next.js App Router(非 Pages Router);TypeScript strict 模式。
- 資料庫:Cloud SQL **MySQL 8**;Prisma `datasource` provider 必為 `"mysql"`。
- 認證:NextAuth **v5**(`next-auth@beta`)+ `@auth/prisma-adapter`;唯一 provider 為 LINE。環境變數名為 `AUTH_LINE_ID`、`AUTH_LINE_SECRET`、`AUTH_SECRET`。
- 漲跌色彩:**紅漲綠跌**(台股慣例),與歐美相反。以 CSS 變數 `--up`(紅)、`--down`(綠)集中定義,禁止散落 hard-code。
- 即時性:盤中報價每分鐘輪詢;後端對外部資料源快取 30–60 秒。
- 隱私:每位使用者只能存取自己的自選股;所有 watchlist 查詢必以 session 的 userId 過濾。
- 台股交易時段判斷:平日(一~五)09:00–13:30(Asia/Taipei)為盤中,其餘為盤後。
- 測試:Vitest;每個任務先寫失敗測試再實作(TDD)。
- 金額 / 代號皆為字串或整數,避免浮點誤差;價格用 `number`(顯示層四捨五入),不做金額運算。
- 環境變數一律透過 `.env`(本機)與 K8s Secret(部署),`.env.example` 需同步列出所有必要變數。

---

### Task 1: 專案骨架與測試工具

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Create: `.env.example`, `.gitignore`(已存在則補充)
- Test: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: 可執行的 Next.js 專案;`pnpm test` 跑 Vitest;`pnpm dev` 起 App Router;全域色彩變數 `--up` / `--down`。

- [ ] **Step 1: 建立專案與安裝依賴**

```bash
cd /home/eddy/nazodex
pnpm init
pnpm add next@latest react react-dom
pnpm add -D typescript @types/react @types/node @types/react-dom \
  tailwindcss postcss autoprefixer \
  vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom
```

- [ ] **Step 2: 寫設定檔**

`tsconfig.json`(strict + `@/*` 路徑別名):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

`postcss.config.mjs`:
```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        up: "var(--up)",     // 紅漲
        down: "var(--down)", // 綠跌
      },
    },
  },
  plugins: [],
} satisfies Config;
```

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

`vitest.setup.ts`:
```typescript
import "@testing-library/dom";
```

- [ ] **Step 3: App Router 基本檔案與色彩變數**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --up: #d92d20;   /* 紅漲 */
  --down: #12b76a; /* 綠跌 */
  --bg: #0b0f14;
  --card: #131a22;
}
html, body { background: var(--bg); color: #e6edf3; }
```

`app/layout.tsx`:
```tsx
import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "NazoDex 台股看板", description: "台股自選股看盤" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-4">NazoDex</main>;
}
```

- [ ] **Step 4: 加測試 script 並寫冒煙測試**

在 `package.json` 的 `scripts` 加:
```json
"scripts": { "dev": "next dev", "build": "next build", "start": "next start", "test": "vitest run", "test:watch": "vitest" }
```

`lib/__tests__/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

`.env.example`:
```bash
DATABASE_URL="mysql://user:pass@host:3306/nazodex"
AUTH_SECRET=""
AUTH_LINE_ID=""
AUTH_LINE_SECRET=""
FINMIND_TOKEN=""
```

- [ ] **Step 5: 執行測試確認通過**

Run: `pnpm test`
Expected: PASS(1 passed）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind and Vitest"
```

---

### Task 2: Prisma schema 與 MySQL 連線

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/prisma.ts`(PrismaClient singleton)
- Test: `lib/__tests__/prisma.test.ts`

**Interfaces:**
- Produces: `import { prisma } from "@/lib/prisma"` — 型別安全的 DB client;model:`User`, `Account`, `Session`, `VerificationToken`(Auth.js 需要),`WatchlistItem`, `Stock`, `DailyQuote`, `UserColumnPref`。

- [ ] **Step 1: 安裝 Prisma**

```bash
pnpm add @prisma/client
pnpm add -D prisma
```

- [ ] **Step 2: 寫失敗測試(singleton 匯出)**

`lib/__tests__/prisma.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
describe("prisma singleton", () => {
  it("exports a client with expected models", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.watchlistItem).toBeDefined();
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `pnpm test lib/__tests__/prisma.test.ts`
Expected: FAIL（找不到 `@/lib/prisma` 或 client 未生成）。

- [ ] **Step 4: 寫 schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ---- Auth.js 需要的表 ----
model User {
  id            String          @id @default(cuid())
  name          String?
  email         String?         @unique
  image         String?
  accounts      Account[]
  sessions      Session[]
  watchlist     WatchlistItem[]
  columnPref    UserColumnPref?
  createdAt     DateTime        @default(now())
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime
  @@unique([identifier, token])
}

// ---- 業務表 ----
model Stock {
  symbol   String       @id            // 如 "2330"
  name     String                      // 如 "台積電"
  market   String                      // "TSE"(上市) / "OTC"(上櫃)
  industry String?
  quotes   DailyQuote[]
}

model WatchlistItem {
  id          String   @id @default(cuid())
  userId      String
  stockSymbol String
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, stockSymbol])
  @@index([userId])
}

model DailyQuote {
  id          String   @id @default(cuid())
  stockSymbol String
  date        DateTime @db.Date
  open        Float
  high        Float
  low         Float
  close       Float
  volume      BigInt
  stock       Stock    @relation(fields: [stockSymbol], references: [symbol], onDelete: Cascade)
  @@unique([stockSymbol, date])
  @@index([stockSymbol])
}

model UserColumnPref {
  userId  String @id
  columns Json   // 使用者選擇顯示的欄位陣列,如 ["price","changePct","yield"]
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 5: 寫 PrismaClient singleton**

`lib/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: 生成 client 並執行測試**

```bash
pnpm exec prisma generate
pnpm test lib/__tests__/prisma.test.ts
```
Expected: PASS。（本測試僅檢查 client 型別 / model 存在,不需真的連 DB。）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema for MySQL and client singleton"
```

> **部署備註(非本任務執行,記錄於此):** schema 遷移用 `pnpm exec prisma migrate deploy`(需連上 Cloud SQL)。本機開發若有連線可用 `prisma migrate dev --name init`。

---

### Task 3: 交易時段判斷(market-hours)

**Files:**
- Create: `lib/market/hours.ts`
- Test: `lib/market/__tests__/hours.test.ts`

**Interfaces:**
- Produces:
  - `isMarketOpen(now: Date): boolean` — 依 Asia/Taipei,週一~五 09:00–13:30 回 true。
  - `taipeiParts(now: Date): { weekday: number; minutes: number }` — 內部輔助,weekday 0=日,minutes 為當日自 00:00 起分鐘數(台北時區)。

- [ ] **Step 1: 寫失敗測試**

`lib/market/__tests__/hours.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isMarketOpen } from "@/lib/market/hours";

// 皆以 UTC 建構,對應台北 = UTC+8
describe("isMarketOpen", () => {
  it("週三 10:00(台北)為盤中", () => {
    // 2026-07-01 是週三;台北 10:00 = UTC 02:00
    expect(isMarketOpen(new Date("2026-07-01T02:00:00Z"))).toBe(true);
  });
  it("週三 08:59(台北)為盤前", () => {
    expect(isMarketOpen(new Date("2026-07-01T00:59:00Z"))).toBe(false);
  });
  it("週三 13:31(台北)為盤後", () => {
    expect(isMarketOpen(new Date("2026-07-01T05:31:00Z"))).toBe(false);
  });
  it("週六為休市", () => {
    // 2026-07-04 週六,台北 10:00
    expect(isMarketOpen(new Date("2026-07-04T02:00:00Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/market`
Expected: FAIL（`isMarketOpen` 未定義)。

- [ ] **Step 3: 實作**

`lib/market/hours.ts`:
```typescript
export function taipeiParts(now: Date): { weekday: number; minutes: number } {
  // 用 Intl 取台北當地時間,避免伺服器時區影響
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayIndex: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayIndex[map.weekday] ?? 0;
  const hour = parseInt(map.hour, 10) % 24;
  const minute = parseInt(map.minute, 10);
  return { weekday, minutes: hour * 60 + minute };
}

export function isMarketOpen(now: Date): boolean {
  const { weekday, minutes } = taipeiParts(now);
  if (weekday === 0 || weekday === 6) return false; // 週末
  const open = 9 * 60;        // 09:00
  const close = 13 * 60 + 30; // 13:30
  return minutes >= open && minutes <= close;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/market`
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Taiwan market-hours detection"
```

---

### Task 4: quote-service 型別與盤後(DB)報價來源

**Files:**
- Create: `lib/quotes/types.ts`
- Create: `lib/quotes/dbSource.ts`
- Test: `lib/quotes/__tests__/dbSource.test.ts`

**Interfaces:**
- Produces:
  - 型別 `Quote = { symbol: string; name: string; price: number; change: number; changePct: number; volume: number; asOf: string }`。
  - `getDailyQuotesFromDb(symbols: string[], prismaClient?): Promise<Quote[]>` — 讀每檔最新兩筆 `DailyQuote` 算漲跌;`prismaClient` 可注入以利測試。

- [ ] **Step 1: 寫失敗測試(注入 mock prisma)**

`lib/quotes/__tests__/dbSource.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { getDailyQuotesFromDb } from "@/lib/quotes/dbSource";

function mockPrisma(rows: any) {
  return {
    stock: { findMany: async () => [{ symbol: "2330", name: "台積電" }] },
    dailyQuote: {
      findMany: async ({ where }: any) =>
        rows.filter((r: any) => r.stockSymbol === where.stockSymbol),
    },
  } as any;
}

describe("getDailyQuotesFromDb", () => {
  it("以最近兩筆收盤價算出漲跌與漲跌幅", async () => {
    const rows = [
      { stockSymbol: "2330", date: new Date("2026-07-01"), close: 1085, volume: 21000n },
      { stockSymbol: "2330", date: new Date("2026-06-30"), close: 1070, volume: 18000n },
    ];
    const quotes = await getDailyQuotesFromDb(["2330"], mockPrisma(rows));
    expect(quotes[0].symbol).toBe("2330");
    expect(quotes[0].price).toBe(1085);
    expect(quotes[0].change).toBe(15);
    expect(quotes[0].changePct).toBeCloseTo(1.4, 1);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/quotes/__tests__/dbSource.test.ts`
Expected: FAIL（模組不存在)。

- [ ] **Step 3: 實作型別與 dbSource**

`lib/quotes/types.ts`:
```typescript
export type Quote = {
  symbol: string;
  name: string;
  price: number;      // 現價 / 收盤
  change: number;     // 漲跌額(相對前一日收盤)
  changePct: number;  // 漲跌幅 %
  volume: number;     // 成交量(張或股,以來源為準)
  asOf: string;       // ISO 時間戳
};
```

`lib/quotes/dbSource.ts`:
```typescript
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { Quote } from "@/lib/quotes/types";

export async function getDailyQuotesFromDb(
  symbols: string[],
  prismaClient: typeof defaultPrisma = defaultPrisma,
): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const stocks = await prismaClient.stock.findMany({
    where: { symbol: { in: symbols } },
  });
  const nameBySymbol = new Map(stocks.map((s: any) => [s.symbol, s.name]));

  const quotes: Quote[] = [];
  for (const symbol of symbols) {
    const rows = await prismaClient.dailyQuote.findMany({
      where: { stockSymbol: symbol },
      orderBy: { date: "desc" },
      take: 2,
    });
    if (rows.length === 0) continue;
    const latest = rows[0];
    const prev = rows[1];
    const price = latest.close;
    const change = prev ? price - prev.close : 0;
    const changePct = prev && prev.close !== 0 ? (change / prev.close) * 100 : 0;
    quotes.push({
      symbol,
      name: nameBySymbol.get(symbol) ?? symbol,
      price,
      change,
      changePct,
      volume: Number(latest.volume),
      asOf: latest.date.toISOString(),
    });
  }
  return quotes;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/quotes/__tests__/dbSource.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add quote types and DB (after-hours) quote source"
```

---

### Task 5: 盤中報價來源(證交所 MIS)+ 記憶體快取

**Files:**
- Create: `lib/quotes/misSource.ts`
- Create: `lib/quotes/cache.ts`
- Test: `lib/quotes/__tests__/misSource.test.ts`
- Test: `lib/quotes/__tests__/cache.test.ts`

**Interfaces:**
- Produces:
  - `parseMisResponse(json: unknown): Quote[]` — 純函式,把 MIS JSON 轉 `Quote[]`(易測)。
  - `fetchIntradayQuotes(symbols: string[], fetchImpl?): Promise<Quote[]>` — 打 MIS API 並回 `Quote[]`;`fetchImpl` 可注入。
  - `memoize<T>(fn, ttlMs): (key: string) => Promise<T>` — 通用 TTL 快取。

- [ ] **Step 1: 寫 cache 失敗測試**

`lib/quotes/__tests__/cache.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { memoize } from "@/lib/quotes/cache";

describe("memoize", () => {
  it("TTL 內回傳快取值,不重複呼叫", async () => {
    let calls = 0;
    const now = { t: 0 };
    const cached = memoize(async (k: string) => { calls++; return `v:${k}`; }, 1000, () => now.t);
    expect(await cached("a")).toBe("v:a");
    expect(await cached("a")).toBe("v:a");
    expect(calls).toBe(1);
    now.t = 2000; // 超過 TTL
    expect(await cached("a")).toBe("v:a");
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/quotes/__tests__/cache.test.ts`
Expected: FAIL。

- [ ] **Step 3: 實作 cache**

`lib/quotes/cache.ts`:
```typescript
type Entry<T> = { value: T; expiresAt: number };

export function memoize<T>(
  fn: (key: string) => Promise<T>,
  ttlMs: number,
  clock: () => number = () => Date.now(),
): (key: string) => Promise<T> {
  const store = new Map<string, Entry<T>>();
  return async (key: string) => {
    const nowMs = clock();
    const hit = store.get(key);
    if (hit && hit.expiresAt > nowMs) return hit.value;
    const value = await fn(key);
    store.set(key, { value, expiresAt: nowMs + ttlMs });
    return value;
  };
}
```

- [ ] **Step 4: 執行 cache 測試確認通過**

Run: `pnpm test lib/quotes/__tests__/cache.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 MIS parser 失敗測試**

證交所 MIS 端點格式(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|otc_xxxx.tw&json=1&delay=0`)回傳 `{ msgArray: [{ c, n, z, y, v, ... }] }`,其中 `c`=代號、`n`=名稱、`z`=最新成交價、`y`=昨收、`v`=累積成交量(張)。

`lib/quotes/__tests__/misSource.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseMisResponse, fetchIntradayQuotes } from "@/lib/quotes/misSource";

const sample = {
  msgArray: [
    { c: "2330", n: "台積電", z: "1085.0", y: "1070.0", v: "21000", tlong: "1751330400000" },
  ],
};

describe("parseMisResponse", () => {
  it("把 MIS JSON 轉成 Quote", () => {
    const quotes = parseMisResponse(sample);
    expect(quotes[0]).toMatchObject({ symbol: "2330", name: "台積電", price: 1085 });
    expect(quotes[0].change).toBeCloseTo(15, 5);
    expect(quotes[0].changePct).toBeCloseTo(1.4, 1);
    expect(quotes[0].volume).toBe(21000);
  });
  it("成交價為 '-'(無成交)時退回昨收", () => {
    const q = parseMisResponse({ msgArray: [{ c: "2330", n: "台積電", z: "-", y: "1070.0", v: "0" }] });
    expect(q[0].price).toBe(1070);
    expect(q[0].change).toBe(0);
  });
});

describe("fetchIntradayQuotes", () => {
  it("以注入的 fetch 取得並解析報價", async () => {
    const fakeFetch = async () =>
      ({ ok: true, json: async () => sample }) as any;
    const quotes = await fetchIntradayQuotes(["2330"], fakeFetch as any);
    expect(quotes[0].symbol).toBe("2330");
  });
});
```

- [ ] **Step 6: 執行測試確認失敗**

Run: `pnpm test lib/quotes/__tests__/misSource.test.ts`
Expected: FAIL。

- [ ] **Step 7: 實作 misSource**

`lib/quotes/misSource.ts`:
```typescript
import type { Quote } from "@/lib/quotes/types";

type MisRow = { c: string; n: string; z?: string; y?: string; v?: string; tlong?: string };

function toNum(s: string | undefined): number | null {
  if (s == null || s === "-" || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseMisResponse(json: unknown): Quote[] {
  const rows = (json as { msgArray?: MisRow[] })?.msgArray ?? [];
  const quotes: Quote[] = [];
  for (const r of rows) {
    const prevClose = toNum(r.y);
    const last = toNum(r.z);
    const price = last ?? prevClose ?? 0;
    const change = prevClose != null ? price - prevClose : 0;
    const changePct = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const asOf = r.tlong ? new Date(Number(r.tlong)).toISOString() : new Date(0).toISOString();
    quotes.push({
      symbol: r.c,
      name: r.n,
      price,
      change,
      changePct,
      volume: toNum(r.v) ?? 0,
      asOf,
    });
  }
  return quotes;
}

// 需判斷上市(tse)或上櫃(otc)。此處預設 tse;實務由 Stock.market 決定,見組裝層。
export function buildExCh(symbols: string[], marketBySymbol?: Map<string, string>): string {
  return symbols
    .map((s) => {
      const m = marketBySymbol?.get(s) === "OTC" ? "otc" : "tse";
      return `${m}_${s}.tw`;
    })
    .join("|");
}

export async function fetchIntradayQuotes(
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
  marketBySymbol?: Map<string, string>,
): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const exCh = buildExCh(symbols, marketBySymbol);
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`MIS request failed: ${res.status}`);
  const json = await res.json();
  return parseMisResponse(json);
}
```

- [ ] **Step 8: 執行測試確認通過**

Run: `pnpm test lib/quotes`
Expected: PASS（cache + misSource + dbSource 全過）。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add TWSE MIS intraday quote source with TTL cache"
```

---

### Task 6: quote-service 組裝層(盤中盤後切換 + 回退)

**Files:**
- Create: `lib/quotes/quoteService.ts`
- Test: `lib/quotes/__tests__/quoteService.test.ts`

**Interfaces:**
- Consumes: `isMarketOpen`(Task 3)、`fetchIntradayQuotes`(Task 5)、`getDailyQuotesFromDb`(Task 4)、`memoize`(Task 5)。
- Produces: `getQuotes(symbols: string[], deps?): Promise<Quote[]>` — 盤中優先打 MIS,失敗回退 DB;盤後直接回 DB。`deps` 可注入 `{ now, isOpen, intraday, db }` 以利測試。

- [ ] **Step 1: 寫失敗測試**

`lib/quotes/__tests__/quoteService.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { getQuotes } from "@/lib/quotes/quoteService";
import type { Quote } from "@/lib/quotes/types";

const q = (symbol: string, src: string): Quote => ({
  symbol, name: src, price: 1, change: 0, changePct: 0, volume: 0, asOf: "x",
});

describe("getQuotes", () => {
  it("盤中優先用即時來源", async () => {
    const intraday = vi.fn(async () => [q("2330", "intraday")]);
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => true, intraday, db });
    expect(out[0].name).toBe("intraday");
    expect(db).not.toHaveBeenCalled();
  });
  it("盤中即時來源失敗時回退 DB", async () => {
    const intraday = vi.fn(async () => { throw new Error("boom"); });
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => true, intraday, db });
    expect(out[0].name).toBe("db");
  });
  it("盤後直接用 DB", async () => {
    const intraday = vi.fn(async () => [q("2330", "intraday")]);
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => false, intraday, db });
    expect(out[0].name).toBe("db");
    expect(intraday).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/quotes/__tests__/quoteService.test.ts`
Expected: FAIL。

- [ ] **Step 3: 實作**

`lib/quotes/quoteService.ts`:
```typescript
import { isMarketOpen } from "@/lib/market/hours";
import { fetchIntradayQuotes } from "@/lib/quotes/misSource";
import { getDailyQuotesFromDb } from "@/lib/quotes/dbSource";
import type { Quote } from "@/lib/quotes/types";

export type QuoteDeps = {
  isOpen?: (now: Date) => boolean;
  intraday?: (symbols: string[]) => Promise<Quote[]>;
  db?: (symbols: string[]) => Promise<Quote[]>;
  now?: () => Date;
};

export async function getQuotes(symbols: string[], deps: QuoteDeps = {}): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const isOpen = deps.isOpen ?? isMarketOpen;
  const intraday = deps.intraday ?? ((s: string[]) => fetchIntradayQuotes(s));
  const db = deps.db ?? ((s: string[]) => getDailyQuotesFromDb(s));
  const now = (deps.now ?? (() => new Date()))();

  if (isOpen(now)) {
    try {
      const live = await intraday(symbols);
      if (live.length > 0) return live;
    } catch {
      // 回退 DB
    }
  }
  return db(symbols);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/quotes`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add quote-service with intraday/after-hours switching and DB fallback"
```

---

### Task 7: NextAuth v5 + LINE 登入 + Prisma adapter

**Files:**
- Create: `auth.ts`(NextAuth 設定)
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `middleware.ts`(保護頁面)
- Create: `app/login/page.tsx`
- Create: `components/SignInButton.tsx`, `components/SignOutButton.tsx`
- Modify: `app/layout.tsx`(包 SessionProvider)
- Create: `components/Providers.tsx`
- Test: `lib/__tests__/auth-config.test.ts`

**Interfaces:**
- Consumes: `prisma`(Task 2)。
- Produces: `import { auth, signIn, signOut, handlers } from "@/auth"`;`auth()` 於 server 取 session;session 內含 `user.id`。

- [ ] **Step 1: 安裝**

```bash
pnpm add next-auth@beta @auth/prisma-adapter
```

- [ ] **Step 2: 寫失敗測試(設定含 LINE provider 且回傳 helper)**

`lib/__tests__/auth-config.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import * as authModule from "@/auth";

describe("auth config", () => {
  it("匯出 handlers / auth / signIn / signOut", () => {
    expect(authModule.handlers).toBeDefined();
    expect(typeof authModule.auth).toBe("function");
    expect(typeof authModule.signIn).toBe("function");
    expect(typeof authModule.signOut).toBe("function");
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `pnpm test lib/__tests__/auth-config.test.ts`
Expected: FAIL（`@/auth` 不存在)。

- [ ] **Step 4: 寫 auth.ts**

`auth.ts`:
```typescript
import NextAuth from "next-auth";
import Line from "next-auth/providers/line";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Line],
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
```

型別擴充 `types/next-auth.d.ts`:
```typescript
import type { DefaultSession } from "next-auth";
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
```

- [ ] **Step 5: 路由 handler、middleware、Providers、登入頁**

`app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

`middleware.ts`(未登入導向 /login):
```typescript
import { auth } from "@/auth";
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLogin = req.nextUrl.pathname.startsWith("/login");
  if (!isLoggedIn && !isLogin) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }
});
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
```

`components/Providers.tsx`:
```tsx
"use client";
import { SessionProvider } from "next-auth/react";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

`components/SignInButton.tsx`:
```tsx
import { signIn } from "@/auth";
export default function SignInButton() {
  return (
    <form action={async () => { "use server"; await signIn("line", { redirectTo: "/" }); }}>
      <button className="rounded bg-[#06C755] px-6 py-3 font-bold text-white" type="submit">
        使用 LINE 登入
      </button>
    </form>
  );
}
```

`components/SignOutButton.tsx`:
```tsx
import { signOut } from "@/auth";
export default function SignOutButton() {
  return (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button className="text-sm text-gray-400" type="submit">登出</button>
    </form>
  );
}
```

`app/login/page.tsx`:
```tsx
import SignInButton from "@/components/SignInButton";
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-bold">NazoDex 台股看板</h1>
      <p className="text-gray-400">用 LINE 登入,開始追蹤你的自選股</p>
      <SignInButton />
    </main>
  );
}
```

修改 `app/layout.tsx` 用 Providers 包住 children:
```tsx
import "./globals.css";
import type { Metadata } from "next";
import Providers from "@/components/Providers";
export const metadata: Metadata = { title: "NazoDex 台股看板", description: "台股自選股看盤" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
```

- [ ] **Step 6: 執行測試確認通過**

Run: `pnpm test lib/__tests__/auth-config.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add LINE login via NextAuth v5 with Prisma adapter"
```

> **設定備註:** 需在 LINE Developers 建立 LINE Login channel,callback URL 設為 `https://<你的網域>/api/auth/callback/line`,並把 channel ID/secret 填入 `AUTH_LINE_ID` / `AUTH_LINE_SECRET`;`AUTH_SECRET` 用 `npx auth secret` 產生。

---

### Task 8: 自選股 API(CRUD + 排序 + 跨使用者隔離)

**Files:**
- Create: `lib/watchlist/service.ts`
- Create: `app/api/watchlist/route.ts`(GET 清單 / POST 新增)
- Create: `app/api/watchlist/[symbol]/route.ts`(DELETE 移除)
- Create: `app/api/watchlist/reorder/route.ts`(PATCH 重新排序)
- Test: `lib/watchlist/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `prisma`(Task 2)。
- Produces:
  - `listWatchlist(userId, p?): Promise<{ stockSymbol: string; sortOrder: number }[]>`
  - `addToWatchlist(userId, symbol, p?): Promise<void>`(重複則忽略)
  - `removeFromWatchlist(userId, symbol, p?): Promise<void>`
  - `reorderWatchlist(userId, symbolsInOrder: string[], p?): Promise<void>`
  - 所有函式都以 `userId` 過濾,確保隔離。

- [ ] **Step 1: 寫失敗測試(mock prisma,含隔離)**

`lib/watchlist/__tests__/service.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  listWatchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist,
} from "@/lib/watchlist/service";

function makeMock() {
  const db: any[] = [];
  return {
    _db: db,
    watchlistItem: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = db.filter((r) => r.userId === where.userId);
        if (orderBy?.sortOrder === "asc") rows = rows.sort((a, b) => a.sortOrder - b.sortOrder);
        return rows.map((r) => ({ ...r }));
      },
      upsert: async ({ where, create }: any) => {
        const exists = db.find(
          (r) => r.userId === where.userId_stockSymbol.userId &&
                 r.stockSymbol === where.userId_stockSymbol.stockSymbol,
        );
        if (!exists) db.push({ ...create });
      },
      deleteMany: async ({ where }: any) => {
        for (let i = db.length - 1; i >= 0; i--) {
          if (db[i].userId === where.userId && db[i].stockSymbol === where.stockSymbol) db.splice(i, 1);
        }
      },
      update: async ({ where, data }: any) => {
        const row = db.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
      },
    },
    $transaction: async (ops: any[]) => { for (const op of ops) await op; },
  } as any;
}

describe("watchlist service", () => {
  it("新增後可列出", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u1", p);
    expect(list.map((x) => x.stockSymbol)).toEqual(["2330"]);
  });
  it("跨使用者隔離:u2 看不到 u1 的清單", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u2", p);
    expect(list).toEqual([]);
  });
  it("重複新增不重覆", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u1", p);
    expect(list.length).toBe(1);
  });
  it("可移除", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await removeFromWatchlist("u1", "2330", p);
    expect(await listWatchlist("u1", p)).toEqual([]);
  });
  it("重新排序更新 sortOrder", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await addToWatchlist("u1", "2454", p);
    await reorderWatchlist("u1", ["2454", "2330"], p);
    const list = await listWatchlist("u1", p);
    expect(list.map((x) => x.stockSymbol)).toEqual(["2454", "2330"]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/watchlist`
Expected: FAIL。

- [ ] **Step 3: 實作 service**

`lib/watchlist/service.ts`:
```typescript
import { prisma as defaultPrisma } from "@/lib/prisma";

type P = typeof defaultPrisma;

export async function listWatchlist(userId: string, p: P = defaultPrisma) {
  const rows = await p.watchlistItem.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r: any) => ({ stockSymbol: r.stockSymbol, sortOrder: r.sortOrder }));
}

export async function addToWatchlist(userId: string, symbol: string, p: P = defaultPrisma) {
  await p.watchlistItem.upsert({
    where: { userId_stockSymbol: { userId, stockSymbol: symbol } },
    create: { id: `${userId}:${symbol}`, userId, stockSymbol: symbol, sortOrder: Date.now() % 1000000 },
    update: {},
  });
}

export async function removeFromWatchlist(userId: string, symbol: string, p: P = defaultPrisma) {
  await p.watchlistItem.deleteMany({ where: { userId, stockSymbol: symbol } });
}

export async function reorderWatchlist(userId: string, symbolsInOrder: string[], p: P = defaultPrisma) {
  const current = await p.watchlistItem.findMany({ where: { userId } });
  const idBySymbol = new Map(current.map((r: any) => [r.stockSymbol, r.id]));
  const ops = symbolsInOrder
    .map((symbol, index) => {
      const id = idBySymbol.get(symbol);
      if (!id) return null;
      return p.watchlistItem.update({ where: { id }, data: { sortOrder: index } });
    })
    .filter(Boolean);
  await p.$transaction(ops as any);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/watchlist`
Expected: PASS（5 passed）。

- [ ] **Step 5: 寫 API route(從 session 取 userId)**

`app/api/watchlist/route.ts`:
```typescript
import { auth } from "@/auth";
import { listWatchlist, addToWatchlist } from "@/lib/watchlist/service";
import { getQuotes } from "@/lib/quotes/quoteService";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const items = await listWatchlist(session.user.id);
  const quotes = await getQuotes(items.map((i) => i.stockSymbol));
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const merged = items.map((i) => ({ ...i, quote: bySymbol.get(i.stockSymbol) ?? null }));
  return Response.json({ items: merged });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbol } = await req.json();
  if (typeof symbol !== "string" || !symbol) return new Response("Bad Request", { status: 400 });
  await addToWatchlist(session.user.id, symbol);
  return Response.json({ ok: true });
}
```

`app/api/watchlist/[symbol]/route.ts`:
```typescript
import { auth } from "@/auth";
import { removeFromWatchlist } from "@/lib/watchlist/service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbol } = await params;
  await removeFromWatchlist(session.user.id, symbol);
  return Response.json({ ok: true });
}
```

`app/api/watchlist/reorder/route.ts`:
```typescript
import { auth } from "@/auth";
import { reorderWatchlist } from "@/lib/watchlist/service";

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbols } = await req.json();
  if (!Array.isArray(symbols)) return new Response("Bad Request", { status: 400 });
  await reorderWatchlist(session.user.id, symbols);
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: watchlist CRUD/reorder service and API with per-user isolation"
```

---

### Task 9: 股票搜尋(名稱 / 代號)

**Files:**
- Create: `lib/stocks/search.ts`
- Create: `app/api/stocks/search/route.ts`
- Test: `lib/stocks/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `prisma`(Task 2)。
- Produces: `searchStocks(query: string, p?): Promise<{ symbol: string; name: string }[]>` — 代號前綴或名稱包含,最多 20 筆。

- [ ] **Step 1: 寫失敗測試**

`lib/stocks/__tests__/search.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { searchStocks } from "@/lib/stocks/search";

function mock(rows: any[]) {
  return {
    stock: {
      findMany: async ({ where, take }: any) => {
        const q = where.OR[0].symbol?.startsWith ?? where.OR[0].symbol?.contains;
        return rows
          .filter((r) =>
            r.symbol.includes(where.OR[0].symbol.contains) ||
            r.name.includes(where.OR[1].name.contains),
          )
          .slice(0, take);
      },
    },
  } as any;
}

describe("searchStocks", () => {
  const rows = [
    { symbol: "2330", name: "台積電" },
    { symbol: "2454", name: "聯發科" },
  ];
  it("用代號搜尋", async () => {
    const r = await searchStocks("2330", mock(rows));
    expect(r[0].symbol).toBe("2330");
  });
  it("用名稱搜尋", async () => {
    const r = await searchStocks("聯發", mock(rows));
    expect(r[0].symbol).toBe("2454");
  });
  it("空字串回空陣列", async () => {
    expect(await searchStocks("", mock(rows))).toEqual([]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/stocks`
Expected: FAIL。

- [ ] **Step 3: 實作**

`lib/stocks/search.ts`:
```typescript
import { prisma as defaultPrisma } from "@/lib/prisma";
type P = typeof defaultPrisma;

export async function searchStocks(query: string, p: P = defaultPrisma) {
  const q = query.trim();
  if (!q) return [];
  const rows = await p.stock.findMany({
    where: { OR: [{ symbol: { contains: q } }, { name: { contains: q } }] },
    take: 20,
  });
  return rows.map((r: any) => ({ symbol: r.symbol, name: r.name }));
}
```

`app/api/stocks/search/route.ts`:
```typescript
import { auth } from "@/auth";
import { searchStocks } from "@/lib/stocks/search";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchStocks(q);
  return Response.json({ results });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/stocks`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: stock search by symbol or name"
```

---

### Task 10: 每日行情 CronJob 腳本(OpenAPI 入庫)

**Files:**
- Create: `scripts/ingest-daily.ts`
- Create: `lib/ingest/twseOpenApi.ts`
- Test: `lib/ingest/__tests__/twseOpenApi.test.ts`

**Interfaces:**
- Produces:
  - `parseTwseDaily(json: unknown): { symbol: string; name: string; open: number; high: number; low: number; close: number; volume: number }[]` — 純函式,解析證交所 OpenAPI 每日收盤。
  - `scripts/ingest-daily.ts` — 可 `node`/`tsx` 執行,呼叫 OpenAPI 並 upsert `Stock` + `DailyQuote`。

- [ ] **Step 1: 寫 parser 失敗測試**

證交所每日收盤 OpenAPI `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` 回傳陣列,欄位含 `Code`、`Name`、`OpeningPrice`、`HighestPrice`、`LowestPrice`、`ClosingPrice`、`TradeVolume`。

`lib/ingest/__tests__/twseOpenApi.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseTwseDaily } from "@/lib/ingest/twseOpenApi";

const sample = [
  {
    Code: "2330", Name: "台積電",
    OpeningPrice: "1080.00", HighestPrice: "1090.00",
    LowestPrice: "1075.00", ClosingPrice: "1085.00", TradeVolume: "21000000",
  },
  { Code: "", Name: "", ClosingPrice: "-", TradeVolume: "-" }, // 應被略過
];

describe("parseTwseDaily", () => {
  it("解析有效列,略過無效列", () => {
    const rows = parseTwseDaily(sample);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "2330", name: "台積電", close: 1085, open: 1080 });
    expect(rows[0].volume).toBe(21000000);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/ingest`
Expected: FAIL。

- [ ] **Step 3: 實作 parser**

`lib/ingest/twseOpenApi.ts`:
```typescript
type Raw = Record<string, string>;
export type DailyRow = {
  symbol: string; name: string;
  open: number; high: number; low: number; close: number; volume: number;
};

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseTwseDaily(json: unknown): DailyRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: DailyRow[] = [];
  for (const r of arr) {
    const symbol = (r.Code ?? "").trim();
    const close = num(r.ClosingPrice);
    if (!symbol || close == null) continue;
    out.push({
      symbol,
      name: (r.Name ?? "").trim(),
      open: num(r.OpeningPrice) ?? close,
      high: num(r.HighestPrice) ?? close,
      low: num(r.LowestPrice) ?? close,
      close,
      volume: num(r.TradeVolume) ?? 0,
    });
  }
  return out;
}

export async function fetchTwseDaily(fetchImpl: typeof fetch = fetch): Promise<DailyRow[]> {
  const res = await fetchImpl("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status}`);
  return parseTwseDaily(await res.json());
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/ingest`
Expected: PASS。

- [ ] **Step 5: 寫入庫腳本**

先安裝 tsx:`pnpm add -D tsx`

`scripts/ingest-daily.ts`:
```typescript
import { prisma } from "@/lib/prisma";
import { fetchTwseDaily } from "@/lib/ingest/twseOpenApi";

async function main() {
  const rows = await fetchTwseDaily();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  console.log(`fetched ${rows.length} rows`);

  for (const r of rows) {
    await prisma.stock.upsert({
      where: { symbol: r.symbol },
      create: { symbol: r.symbol, name: r.name, market: "TSE" },
      update: { name: r.name },
    });
    await prisma.dailyQuote.upsert({
      where: { stockSymbol_date: { stockSymbol: r.symbol, date: today } },
      create: {
        stockSymbol: r.symbol, date: today,
        open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
      },
      update: {
        open: r.open, high: r.high, low: r.low, close: r.close, volume: BigInt(r.volume),
      },
    });
  }
  console.log("ingest done");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

在 `package.json` scripts 加:`"ingest:daily": "tsx scripts/ingest-daily.ts"`

- [ ] **Step 6: 執行測試確認全綠**

Run: `pnpm test`
Expected: PASS(全部)。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: daily quote ingestion from TWSE OpenAPI"
```

> **備註:** 上櫃(OTC)可另接櫃買 OpenAPI(`https://www.tpex.org.tw/openapi/...`),v1 先做上市;OTC 於後續版本用同一 parser 模式擴充,並把 `market` 設 `"OTC"`。

---

### Task 11: 前端 —— App 外殼、底部導覽、色彩工具

**Files:**
- Create: `components/layout/AppShell.tsx`
- Create: `components/layout/BottomNav.tsx`
- Create: `lib/format.ts`(格式化 + 漲跌色)
- Modify: `app/page.tsx`(套外殼,顯示大盤列)
- Test: `lib/__tests__/format.test.ts`

**Interfaces:**
- Produces:
  - `changeColorClass(change: number): string` — 漲回 `"text-up"`、跌回 `"text-down"`、平回 `"text-gray-400"`。
  - `fmtPrice(n: number): string`、`fmtPct(n: number): string`、`fmtSignedPct(n: number): string`(帶 +/-)。
  - `AppShell`(含頂列 + BottomNav 的響應式外殼)。

- [ ] **Step 1: 寫 format 失敗測試**

`lib/__tests__/format.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

describe("format", () => {
  it("漲用紅(up)、跌用綠(down)", () => {
    expect(changeColorClass(1)).toBe("text-up");
    expect(changeColorClass(-1)).toBe("text-down");
    expect(changeColorClass(0)).toBe("text-gray-400");
  });
  it("價格與帶號百分比", () => {
    expect(fmtPrice(1085)).toBe("1,085.00");
    expect(fmtSignedPct(1.4)).toBe("+1.40%");
    expect(fmtSignedPct(-1.86)).toBe("-1.86%");
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/__tests__/format.test.ts`
Expected: FAIL。

- [ ] **Step 3: 實作 format**

`lib/format.ts`:
```typescript
export function changeColorClass(change: number): string {
  if (change > 0) return "text-up";
  if (change < 0) return "text-down";
  return "text-gray-400";
}
export function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}
export function fmtSignedPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/__tests__/format.test.ts`
Expected: PASS。

- [ ] **Step 5: 寫 AppShell 與 BottomNav**

`components/layout/BottomNav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "自選" },
  { href: "/market", label: "大盤" },
  { href: "/screener", label: "選股" },
  { href: "/holdings", label: "持股" },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-white/10 bg-[var(--card)] md:hidden">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`flex-1 py-3 text-center text-sm ${path === t.href ? "text-up font-bold" : "text-gray-400"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

`components/layout/AppShell.tsx`:
```tsx
import BottomNav from "@/components/layout/BottomNav";
import SignOutButton from "@/components/SignOutButton";

export default function AppShell({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl pb-16 md:pb-0">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h1 className="text-lg font-bold">{title}</h1>
        <SignOutButton />
      </header>
      <main className="p-4">{children}</main>
      <BottomNav />
    </div>
  );
}
```

修改 `app/page.tsx` 暫時套殼(下一任務填內容):
```tsx
import AppShell from "@/components/layout/AppShell";
export default function Home() {
  return <AppShell title="台股看板"><p className="text-gray-400">自選股載入中…</p></AppShell>;
}
```

- [ ] **Step 6: 執行測試確認全綠**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: app shell, bottom nav, and formatting utils (red-up/green-down)"
```

---

### Task 12: 前端 —— 自選股清單(卡片 / 表格 + 每分鐘刷新)

**Files:**
- Create: `components/watchlist/WatchlistView.tsx`(client,輪詢 + 響應式)
- Create: `components/watchlist/QuoteCard.tsx`(手機卡片)
- Create: `components/watchlist/QuoteRow.tsx`(電腦表格列)
- Create: `components/watchlist/AddStock.tsx`(搜尋加入)
- Modify: `app/page.tsx`(改用 WatchlistView)
- Test: `components/watchlist/__tests__/QuoteCard.test.tsx`

**Interfaces:**
- Consumes: `/api/watchlist`(GET)、`/api/watchlist`(POST)、`/api/watchlist/[symbol]`(DELETE)、`/api/stocks/search`;`changeColorClass` / `fmtPrice` / `fmtSignedPct`(Task 11)。
- Produces: 完整可用的自選股頁,每 60 秒重新抓報價。

- [ ] **Step 1: 寫 QuoteCard 失敗測試(純顯示元件)**

`components/watchlist/__tests__/QuoteCard.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QuoteCard from "@/components/watchlist/QuoteCard";

describe("QuoteCard", () => {
  it("顯示名稱、代號、價格與漲跌,漲用 up 色", () => {
    render(<QuoteCard quote={{
      symbol: "2330", name: "台積電", price: 1085, change: 15, changePct: 1.4, volume: 21000, asOf: "x",
    }} onRemove={() => {}} />);
    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.getByText("2330")).toBeTruthy();
    const pct = screen.getByText("+1.40%");
    expect(pct.className).toContain("text-up");
  });
});
```

（若需 `toBeTruthy`/DOM 斷言,已由 jsdom + testing-library 提供;`.className` 檢查即可,不必額外 matcher。)

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test components/watchlist`
Expected: FAIL。

- [ ] **Step 3: 實作 QuoteCard / QuoteRow**

`components/watchlist/QuoteCard.tsx`:
```tsx
"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

export default function QuoteCard({ quote, onRemove }: { quote: Quote; onRemove: (s: string) => void }) {
  const c = changeColorClass(quote.change);
  return (
    <div className="flex items-center justify-between rounded-lg bg-[var(--card)] p-4">
      <Link href={`/stock/${quote.symbol}`} className="flex-1">
        <div className="font-bold">{quote.name}</div>
        <div className="text-xs text-gray-400">{quote.symbol}</div>
      </Link>
      <div className="text-right">
        <div className={`text-xl font-bold ${c}`}>{fmtPrice(quote.price)}</div>
        <div className={`text-sm ${c}`}>
          {quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : ""} {fmtSignedPct(quote.changePct)}
        </div>
      </div>
      <button onClick={() => onRemove(quote.symbol)} className="ml-3 text-gray-500" aria-label="移除">✕</button>
    </div>
  );
}
```

`components/watchlist/QuoteRow.tsx`:
```tsx
"use client";
import Link from "next/link";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

export default function QuoteRow({ quote, onRemove }: { quote: Quote; onRemove: (s: string) => void }) {
  const c = changeColorClass(quote.change);
  return (
    <tr className="border-b border-white/5">
      <td className="py-2"><Link href={`/stock/${quote.symbol}`}>{quote.name}<span className="ml-2 text-xs text-gray-400">{quote.symbol}</span></Link></td>
      <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(quote.price)}</td>
      <td className={`py-2 text-right ${c}`}>{fmtSignedPct(quote.changePct)}</td>
      <td className="py-2 text-right text-gray-400">{quote.volume.toLocaleString()}</td>
      <td className="py-2 text-right"><button onClick={() => onRemove(quote.symbol)} className="text-gray-500" aria-label="移除">✕</button></td>
    </tr>
  );
}
```

- [ ] **Step 4: 執行 QuoteCard 測試確認通過**

Run: `pnpm test components/watchlist`
Expected: PASS。

- [ ] **Step 5: 實作 AddStock 與 WatchlistView(輪詢)**

`components/watchlist/AddStock.tsx`:
```tsx
"use client";
import { useState } from "react";

export default function AddStock({ onAdded }: { onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);

  async function search(v: string) {
    setQ(v);
    if (!v.trim()) { setResults([]); return; }
    const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(v)}`);
    const json = await res.json();
    setResults(json.results ?? []);
  }
  async function add(symbol: string) {
    await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    setQ(""); setResults([]); onAdded();
  }
  return (
    <div className="relative mb-4">
      <input value={q} onChange={(e) => search(e.target.value)}
        placeholder="搜尋股票代號或名稱(如 2330 / 台積電)"
        className="w-full rounded bg-[var(--card)] px-4 py-2 outline-none" />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded bg-[var(--card)] shadow-lg">
          {results.map((r) => (
            <li key={r.symbol}>
              <button onClick={() => add(r.symbol)} className="flex w-full justify-between px-4 py-2 hover:bg-white/5">
                <span>{r.name}</span><span className="text-gray-400">{r.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`components/watchlist/WatchlistView.tsx`:
```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import type { Quote } from "@/lib/quotes/types";
import QuoteCard from "@/components/watchlist/QuoteCard";
import QuoteRow from "@/components/watchlist/QuoteRow";
import AddStock from "@/components/watchlist/AddStock";

type Item = { stockSymbol: string; sortOrder: number; quote: Quote | null };

export default function WatchlistView() {
  const [items, setItems] = useState<Item[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/watchlist");
    if (!res.ok) return;
    const json = await res.json();
    setItems(json.items ?? []);
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // 每分鐘刷新
    return () => clearInterval(id);
  }, [load]);

  async function remove(symbol: string) {
    await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
    load();
  }

  const quotes = items.map((i) => i.quote).filter((q): q is Quote => q != null);

  return (
    <div>
      <AddStock onAdded={load} />
      <div className="mb-2 text-right text-xs text-gray-500">更新於 {updatedAt}</div>

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {quotes.map((q) => <QuoteCard key={q.symbol} quote={q} onRemove={remove} />)}
      </div>

      {/* 電腦:表格 */}
      <table className="hidden w-full md:table">
        <thead className="text-left text-xs text-gray-500">
          <tr><th>名稱</th><th className="text-right">成交</th><th className="text-right">漲跌幅</th><th className="text-right">量</th><th></th></tr>
        </thead>
        <tbody>
          {quotes.map((q) => <QuoteRow key={q.symbol} quote={q} onRemove={remove} />)}
        </tbody>
      </table>

      {quotes.length === 0 && <p className="text-gray-400">還沒有自選股,用上面的搜尋框加入吧。</p>}
    </div>
  );
}
```

修改 `app/page.tsx`:
```tsx
import AppShell from "@/components/layout/AppShell";
import WatchlistView from "@/components/watchlist/WatchlistView";
export default function Home() {
  return <AppShell title="台股看板"><WatchlistView /></AppShell>;
}
```

- [ ] **Step 6: 執行測試確認全綠**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: watchlist view with responsive cards/table and per-minute refresh"
```

---

### Task 13: 前端 —— 個股細節頁(K 線 + 週期切換)

**Files:**
- Create: `app/stock/[symbol]/page.tsx`(server:抓歷史)
- Create: `app/api/stocks/[symbol]/history/route.ts`
- Create: `lib/stocks/history.ts`
- Create: `components/stock/PriceChart.tsx`(client,lightweight-charts)
- Test: `lib/stocks/__tests__/history.test.ts`

**Interfaces:**
- Consumes: `prisma`(Task 2)。
- Produces:
  - `getHistory(symbol, days, p?): Promise<{ time: string; open: number; high: number; low: number; close: number }[]>` — 由 `DailyQuote` 取近 N 日,時間升冪。
  - 個股頁顯示名稱、現價、K 線圖(可切日 / 週 / 月粒度——v1 先日,週月由日資料聚合)。

- [ ] **Step 1: 寫 history 失敗測試**

`lib/stocks/__tests__/history.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { getHistory } from "@/lib/stocks/history";

function mock(rows: any[]) {
  return {
    dailyQuote: {
      findMany: async ({ where, orderBy, take }: any) => {
        let r = rows.filter((x) => x.stockSymbol === where.stockSymbol);
        r = r.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, take);
        return r;
      },
    },
  } as any;
}

describe("getHistory", () => {
  it("回傳時間升冪的 OHLC", async () => {
    const rows = [
      { stockSymbol: "2330", date: new Date("2026-06-30"), open: 1070, high: 1075, low: 1060, close: 1070 },
      { stockSymbol: "2330", date: new Date("2026-07-01"), open: 1080, high: 1090, low: 1075, close: 1085 },
    ];
    const h = await getHistory("2330", 30, mock(rows));
    expect(h[0].time).toBe("2026-06-30");
    expect(h[1].close).toBe(1085);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm test lib/stocks/__tests__/history.test.ts`
Expected: FAIL。

- [ ] **Step 3: 實作 history**

`lib/stocks/history.ts`:
```typescript
import { prisma as defaultPrisma } from "@/lib/prisma";
type P = typeof defaultPrisma;

export async function getHistory(symbol: string, days: number, p: P = defaultPrisma) {
  const rows = await p.dailyQuote.findMany({
    where: { stockSymbol: symbol },
    orderBy: { date: "desc" },
    take: days,
  });
  return rows
    .map((r: any) => ({
      time: r.date.toISOString().slice(0, 10),
      open: r.open, high: r.high, low: r.low, close: r.close,
    }))
    .sort((a: any, b: any) => (a.time < b.time ? -1 : 1));
}
```

`app/api/stocks/[symbol]/history/route.ts`:
```typescript
import { auth } from "@/auth";
import { getHistory } from "@/lib/stocks/history";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { symbol } = await params;
  const days = Number(new URL(req.url).searchParams.get("days") ?? "60");
  const data = await getHistory(symbol, days);
  return Response.json({ data });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm test lib/stocks/__tests__/history.test.ts`
Expected: PASS。

- [ ] **Step 5: 實作圖表元件與頁面**

```bash
pnpm add lightweight-charts
```

`components/stock/PriceChart.tsx`:
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

type Bar = { time: string; open: number; high: number; low: number; close: number };

export default function PriceChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(60);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 320,
      layout: { background: { color: "transparent" }, textColor: "#9aa4b2" },
      grid: { horzLines: { color: "#ffffff10" }, vertLines: { color: "#ffffff10" } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#d92d20", downColor: "#12b76a",      // 紅漲綠跌
      borderUpColor: "#d92d20", borderDownColor: "#12b76a",
      wickUpColor: "#d92d20", wickDownColor: "#12b76a",
    });
    let alive = true;
    fetch(`/api/stocks/${symbol}/history?days=${days}`)
      .then((r) => r.json())
      .then((json) => { if (alive) series.setData((json.data ?? []) as Bar[]); });
    const onResize = () => chart.applyOptions({ width: ref.current?.clientWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => { alive = false; window.removeEventListener("resize", onResize); chart.remove(); };
  }, [symbol, days]);

  return (
    <div>
      <div className="mb-2 flex gap-2">
        {[30, 60, 120].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`rounded px-3 py-1 text-sm ${days === d ? "bg-white/10 font-bold" : "text-gray-400"}`}>
            {d}日
          </button>
        ))}
      </div>
      <div ref={ref} />
    </div>
  );
}
```

`app/stock/[symbol]/page.tsx`:
```tsx
import AppShell from "@/components/layout/AppShell";
import PriceChart from "@/components/stock/PriceChart";
import { getQuotes } from "@/lib/quotes/quoteService";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [quote] = await getQuotes([symbol]);
  return (
    <AppShell title={quote ? `${quote.name} ${symbol}` : symbol}>
      {quote && (
        <div className="mb-4">
          <span className="text-3xl font-bold">{quote.price.toFixed(2)}</span>
        </div>
      )}
      <PriceChart symbol={symbol} />
    </AppShell>
  );
}
```

- [ ] **Step 6: 執行測試確認全綠**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 7: 手動驗證(需可連 DB / 有資料時)**

Run: `pnpm dev`,登入後點自選股卡片,確認進到細節頁且 K 線可切換天數。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: stock detail page with candlestick chart and period switch"
```

> **註:** 週 / 月粒度由日資料聚合為後續增強;v1 提供 30/60/120 日切換即滿足漸進式揭露需求。

---

### Task 14: 容器化與 GKE 部署資源

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `k8s/deployment.yaml`
- Create: `k8s/cronjob.yaml`
- Create: `k8s/secret.example.yaml`
- Create: `docs/DEPLOY.md`

**Interfaces:**
- Produces: 可 build 的 image、GKE 上的 Deployment(web)+ CronJob(每日行情)+ Secret 範本。

- [ ] **Step 1: 寫 Dockerfile(Next.js standalone)**

`Dockerfile`:
```dockerfile
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`:
```
node_modules
.next
.git
docs
*.md
.env*
```

- [ ] **Step 2: 寫 K8s Deployment + Service**

`k8s/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nazodex-web
spec:
  replicas: 1
  selector:
    matchLabels: { app: nazodex-web }
  template:
    metadata:
      labels: { app: nazodex-web }
    spec:
      containers:
        - name: web
          image: REGISTRY/nazodex:latest   # 替換為你的 image
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef: { name: nazodex-secrets }
          readinessProbe:
            httpGet: { path: /login, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: nazodex-web
spec:
  selector: { app: nazodex-web }
  ports:
    - port: 80
      targetPort: 3000
```

- [ ] **Step 3: 寫每日行情 CronJob**

`k8s/cronjob.yaml`(台股收盤 13:30 後,設 UTC 07:00 = 台北 15:00,平日執行):
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nazodex-ingest-daily
spec:
  schedule: "0 7 * * 1-5"   # UTC 07:00 週一到五 = 台北 15:00
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: ingest
              image: REGISTRY/nazodex:latest
              command: ["node", "node_modules/.bin/tsx", "scripts/ingest-daily.ts"]
              envFrom:
                - secretRef: { name: nazodex-secrets }
```

> 註:若 runner image 未含 devDependencies(tsx),CronJob 改用預先編譯的 JS,或在 builder 階段 `pnpm build` 時一併把 `scripts/ingest-daily.ts` 編成 `dist/ingest-daily.js` 並以 `node dist/ingest-daily.js` 執行。實作時擇一,並在 `docs/DEPLOY.md` 記錄所選方式。

- [ ] **Step 4: Secret 範本與部署文件**

`k8s/secret.example.yaml`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nazodex-secrets
type: Opaque
stringData:
  DATABASE_URL: "mysql://user:pass@CLOUD_SQL_HOST:3306/nazodex"
  AUTH_SECRET: "REPLACE"
  AUTH_LINE_ID: "REPLACE"
  AUTH_LINE_SECRET: "REPLACE"
  AUTH_URL: "https://your-domain"
  FINMIND_TOKEN: ""
```

`docs/DEPLOY.md`(重點步驟):
```markdown
# 部署到 GKE

1. 建 LINE Login channel,callback = https://<網域>/api/auth/callback/line
2. 產生 AUTH_SECRET:`npx auth secret`
3. 建立 secret:`kubectl apply -f k8s/secret.example.yaml`(先填好值)
4. 遷移 DB:一次性 Job 或本機連線執行 `pnpm exec prisma migrate deploy`
5. Build & push:`docker build -t REGISTRY/nazodex:latest . && docker push REGISTRY/nazodex:latest`
6. 部署:`kubectl apply -f k8s/deployment.yaml -f k8s/cronjob.yaml`
7. 首次灌資料:手動觸發一次 `kubectl create job --from=cronjob/nazodex-ingest-daily first-run`
8. 對外:用你叢集既有的 Ingress / LoadBalancer 指向 nazodex-web Service,綁網域與憑證
9. Cloud SQL 連線:用 Cloud SQL Auth Proxy sidecar 或私有 IP(擇一,於 deployment 補上)
```

- [ ] **Step 5: 驗證 build**

Run: `docker build -t nazodex:test .`
Expected: build 成功(需本機有 Docker）。若無 Docker,略過此步並在文件註記。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add Dockerfile and GKE manifests (deployment + daily cronjob)"
```

---

## 完成後全域驗證

- [ ] `pnpm test` 全綠。
- [ ] `pnpm build` 成功(Next.js standalone 產出)。
- [ ] 連上 Cloud SQL 後 `pnpm exec prisma migrate deploy` 成功建表。
- [ ] 手動跑一次 `pnpm ingest:daily` 灌入當日行情。
- [ ] `pnpm dev` → LINE 登入 → 加自選股 → 看到報價 → 點入看 K 線。

---

## Self-Review 覆蓋對照(spec → task)

| Spec 章節 | 對應 Task |
|-----------|-----------|
| 架構(單體 Next.js + MySQL + CronJob) | Task 1, 2, 14 |
| 資料源分層 / quote-service 抽象 | Task 4, 5, 6 |
| 盤中盤後切換 + 回退 | Task 3, 6 |
| 資料模型 | Task 2 |
| LINE 登入 / 各自獨立清單 | Task 7, 8 |
| 看盤畫面(手機卡片 / 電腦表格 / 每分鐘刷新) | Task 11, 12 |
| 搜尋加入自選股 | Task 9, 12 |
| 個股細節頁(K 線 / 週期切換 / 漸進式揭露) | Task 13 |
| 每日行情 CronJob 入庫 | Task 10, 14 |
| 錯誤處理(來源失敗回退、未登入擋下) | Task 6, 7, 8 |
| 紅漲綠跌 | Task 11, 12, 13(色彩集中於 CSS 變數 + `changeColorClass`) |
| 部署 GKE | Task 14 |
| 非目標(不做 tick / 選股 / 損益 / 下單) | 全計畫範圍外,未列 task |

未列入但已知的後續增強(記錄,非本計畫):OTC 上櫃資料源、週/月 K 聚合、自選股欄位自訂 UI(schema 已備 `UserColumnPref`)。
