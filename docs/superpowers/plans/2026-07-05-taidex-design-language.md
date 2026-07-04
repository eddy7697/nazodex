# Taidex 設計語言 UI 導入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「金脈 Golden Ridge」素材導入 UI——brand token、邊緣透明化資產管線、空狀態元件、Logo/app icon、背景紋理。

**Architecture:** 資產處理走 build-time 腳本(sharp 管線,亮度轉 alpha + 邊緣淡出,輸出到 `public/` 分類目錄與 `app/icon.png`);UI 端新增 `EmptyState` 共用元件接管四種空狀態,`AppShell`/登入頁掛品牌素材,`globals.css` 收 brand token 與背景紋理。像素轉換為純函式(Vitest 可測),與 sharp I/O 分離。

**Tech Stack:** Next.js 16 App Router、sharp(devDependency)、Tailwind 3、Vitest + Testing Library(jsdom)。

## Global Constraints

- 紅漲綠跌是語意色:素材與品牌色**禁用紅綠**;品牌金 `--brand: #f59e0b`、`--brand-bright: #fbbf24`。
- 顏色不得寫死 hex 在元件裡(集中於 CSS 變數與 tailwind token)。
- 圖片一律用小寫英文、依用途命名(`empty/watchlist.webp`),程式碼引用不含 `public` 前綴。
- 原始 PNG 母檔目錄 `public/taidex_assets/` 不進 repo(gitignore),處理後輸出檔才 commit。
- TDD:純函式與元件先寫失敗測試。
- 完成門檻:`pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build` 全綠後才發 PR;不直接 commit master。

---

### Task 1: 開分支 + 像素轉換純函式(TDD)

**Files:**
- Create: `scripts/asset-pipeline.lib.mjs`
- Test: `scripts/__tests__/asset-pipeline.test.ts`

**Interfaces:**
- Produces: `lumaToAlpha(data: Uint8Array | Buffer): void`(就地修改 RGBA buffer;alpha = max(r,g,b),色彩反預乘保持發光感)
- Produces: `edgeFade(data, width, height, margin): void`(就地把距邊緣 < margin px 的 alpha 線性淡出)

- [ ] **Step 1: 開分支**

```bash
git checkout master && git checkout -b feat/design-language
```

- [ ] **Step 2: 寫失敗測試**

`scripts/__tests__/asset-pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lumaToAlpha, edgeFade } from "../asset-pipeline.lib.mjs";

describe("lumaToAlpha", () => {
  it("純黑變全透明", () => {
    const px = new Uint8Array([0, 0, 0, 255]);
    lumaToAlpha(px);
    expect(px[3]).toBe(0);
  });
  it("亮金色線條保持不透明且色彩反預乘", () => {
    // 半亮金 (200,150,20) → alpha=200,RGB 依 255/200 放大
    const px = new Uint8Array([200, 150, 20, 255]);
    lumaToAlpha(px);
    expect(px[3]).toBe(200);
    expect(px[0]).toBe(255);                 // 200*255/200
    expect(px[1]).toBe(Math.round((150 * 255) / 200)); // 191
    expect(px[2]).toBe(Math.round((20 * 255) / 200));  // 26
  });
  it("反預乘不超過 255", () => {
    const px = new Uint8Array([255, 255, 255, 255]);
    lumaToAlpha(px);
    expect([...px]).toEqual([255, 255, 255, 255]);
  });
});

describe("edgeFade", () => {
  it("邊緣像素 alpha 歸零、中心不變", () => {
    // 5x5 全白全不透明,margin=2
    const w = 5, h = 5;
    const data = new Uint8Array(w * h * 4).fill(255);
    edgeFade(data, w, h, 2);
    const alphaAt = (x: number, y: number) => data[(y * w + x) * 4 + 3];
    expect(alphaAt(0, 2)).toBe(0);        // 貼邊 → 0
    expect(alphaAt(1, 2)).toBe(128);      // 距邊 1/margin 2 → 一半
    expect(alphaAt(2, 2)).toBe(255);      // 中心 → 不變
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `pnpm exec vitest run scripts/__tests__/asset-pipeline.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 4: 最小實作**

`scripts/asset-pipeline.lib.mjs`:

```js
// 素材像素轉換純函式(與 sharp I/O 分離,可單元測試)。
// lumaToAlpha:深色底發光線條圖 → 透明底。alpha 取 max(r,g,b),
// 色彩反預乘(除以 alpha)讓合成回深色底時視覺等同原圖(近似 additive)。
export function lumaToAlpha(data) {
  for (let i = 0; i < data.length; i += 4) {
    const a = Math.max(data[i], data[i + 1], data[i + 2]);
    if (a === 0) { data[i] = data[i + 1] = data[i + 2] = 0; }
    else {
      data[i] = Math.min(255, Math.round((data[i] * 255) / a));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a));
    }
    data[i + 3] = a;
  }
}

// edgeFade:距任一邊 < margin px 的像素,alpha 依距離線性淡出到 0。
export function edgeFade(data, width, height, margin) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (d >= margin) continue;
      const i = (y * width + x) * 4 + 3;
      data[i] = Math.round((data[i] * d) / margin);
    }
  }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm exec vitest run scripts/__tests__/asset-pipeline.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/asset-pipeline.lib.mjs scripts/__tests__/asset-pipeline.test.ts
git commit -m "feat: 素材像素轉換純函式——亮度轉alpha(發光線條去背)+邊緣淡出"
```

---

### Task 2: 資產管線腳本 + 產出正式素材

**Files:**
- Create: `scripts/prepare-assets.mjs`
- Delete: `scripts/convert-assets.mjs`(被本腳本取代)
- Modify: `package.json`(scripts:`assets:webp` → `assets:prepare`)
- Modify: `.gitignore`(加 `public/taidex_assets/`)

**Interfaces:**
- Consumes: Task 1 的 `lumaToAlpha` / `edgeFade`
- Produces: 檔案 `public/brand/logo.webp`、`public/brand/logo-name.webp`、`public/empty/{watchlist,holdings,screener,market-closed}.webp`、`public/textures/{contour,header}.webp`、`app/icon.png`——後續 Task 以這些路徑引用

- [ ] **Step 1: 寫腳本**

`scripts/prepare-assets.mjs`:

```js
// 把 public/taidex_assets/ 原始 PNG 處理成正式素材:
// 亮度轉 alpha(透明底,可浮在任何深色上)+ 邊緣淡出 + 分類輸出 WebP。
// 用法:pnpm assets:prepare
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { lumaToAlpha, edgeFade } from "./asset-pipeline.lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/taidex_assets");

// crop: 1024x1536 直式空狀態圖取上方 1024x1024 內容區(下方留白給 UI 文案,不要)
const JOBS = [
  { src: "logo.png",            out: "public/brand/logo.webp",            width: 512, alpha: true },
  { src: "logo_with_name.png",  out: "public/brand/logo-name.webp",       width: 768, alpha: true },
  { src: "app_icon.png",        out: "app/icon.png",                      width: 512, png: true },
  { src: "status_自選股.png",     out: "public/empty/watchlist.webp",     width: 640, alpha: true, fade: 48, crop: { left: 0, top: 128, width: 1024, height: 1024 } },
  { src: "status_無持股.png",     out: "public/empty/holdings.webp",      width: 640, alpha: true, fade: 48, crop: { left: 0, top: 128, width: 1024, height: 1024 } },
  { src: "status_選股無結果.png", out: "public/empty/screener.webp",      width: 640, alpha: true, fade: 48, crop: { left: 0, top: 128, width: 1024, height: 1024 } },
  { src: "status_休市.png",       out: "public/empty/market-closed.webp", width: 640, alpha: true, fade: 48, crop: { left: 0, top: 128, width: 1024, height: 1024 } },
  { src: "等高地紋圖.png",        out: "public/textures/contour.webp",    width: 1024 },
  { src: "header.png",          out: "public/textures/header.webp",       width: 1024, alpha: true },
];

for (const job of JOBS) {
  const dst = path.join(ROOT, job.out);
  await mkdir(path.dirname(dst), { recursive: true });

  let img = sharp(path.join(SRC, job.src));
  if (job.crop) img = img.extract(job.crop);
  img = img.resize({ width: job.width, withoutEnlargement: true });

  if (job.alpha) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    lumaToAlpha(data);
    if (job.fade) edgeFade(data, info.width, info.height, job.fade);
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }

  const { size } = job.png
    ? await img.png().toFile(dst)
    : await img.webp({ quality: 82 }).toFile(dst);
  console.log(`done  ${job.src} → ${job.out}  ${(size / 1024).toFixed(0)}KB`);
}
```

- [ ] **Step 2: 更新 package.json 與 .gitignore,移除舊腳本**

```bash
rm scripts/convert-assets.mjs public/taidex_assets/*.webp
```

`package.json` scripts 區:把 `"assets:webp": "node scripts/convert-assets.mjs"` 改為 `"assets:prepare": "node scripts/prepare-assets.mjs"`。

`.gitignore` 追加一行:

```
public/taidex_assets/
```

- [ ] **Step 3: 跑管線產出素材**

Run: `pnpm assets:prepare`
Expected: 9 行 `done`,產出 `public/brand/` ×2、`public/empty/` ×4、`public/textures/` ×2、`app/icon.png`

- [ ] **Step 4: 目視抽查透明化結果**

用 Read 工具看 `public/empty/market-closed.webp` 與 `public/brand/logo.webp`:深色底應已變透明(檢視器會顯示棋盤格或黑底),線條發光完整、邊緣柔和淡出、無白邊硬邊。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 資產管線——素材透明化+邊緣淡出+分類輸出;原始PNG不進repo"
```

---

### Task 3: brand token + 頁面背景紋理

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Produces: CSS 變數 `--brand` / `--brand-bright`;Tailwind class `text-brand` / `bg-brand` 等(供後續與未來元件使用)

- [ ] **Step 1: globals.css 加 token 與背景**

```css
:root {
  --up: #d92d20;   /* 紅漲 */
  --down: #12b76a; /* 綠跌 */
  --bg: #0b0f14;
  --card: #131a22;
  --brand: #f59e0b;        /* 品牌金(金脈 Golden Ridge) */
  --brand-bright: #fbbf24; /* 品牌金亮部 */
}
html, body { background: var(--bg); color: #e6edf3; }
/* 等高線地形紋:極低對比,鋪在頁面底層,固定不隨捲動 */
body {
  background-image: url("/textures/contour.webp");
  background-size: 640px;
  background-attachment: fixed;
}
```

- [ ] **Step 2: tailwind.config.ts 加色**

```ts
colors: {
  up: "var(--up)",     // 紅漲
  down: "var(--down)", // 綠跌
  brand: "var(--brand)",
  "brand-bright": "var(--brand-bright)",
},
```

- [ ] **Step 3: 驗證編譯**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 皆成功

- [ ] **Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat: brand token(品牌金)+ 等高線背景紋理"
```

---

### Task 4: EmptyState 元件(TDD)

**Files:**
- Create: `components/ui/EmptyState.tsx`
- Test: `components/ui/__tests__/EmptyState.test.tsx`

**Interfaces:**
- Produces: `EmptyState({ variant, children }: { variant: "watchlist" | "holdings" | "screener" | "closed"; children: React.ReactNode })`——圖 + 置中文案;Task 5 直接以此替換各處空狀態 `<p>`

- [ ] **Step 1: 寫失敗測試**

`components/ui/__tests__/EmptyState.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyState from "@/components/ui/EmptyState";

describe("EmptyState", () => {
  it("依 variant 渲染對應圖片與文案", () => {
    const { container } = render(<EmptyState variant="watchlist">還沒有自選股</EmptyState>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/empty/watchlist.webp");
    expect(screen.getByText("還沒有自選股")).toBeTruthy();
  });
  it("closed variant 用休市圖", () => {
    const { container } = render(<EmptyState variant="closed">暫無資料</EmptyState>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/empty/market-closed.webp");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run components/ui`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作**

`components/ui/EmptyState.tsx`:

```tsx
const VARIANTS = {
  watchlist: "/empty/watchlist.webp",
  holdings: "/empty/holdings.webp",
  screener: "/empty/screener.webp",
  closed: "/empty/market-closed.webp",
} as const;

// 空狀態:發光線條插圖(透明底)+ 置中文案。圖為裝飾性,語意由文案承擔(alt="")。
export default function EmptyState({
  variant, children,
}: { variant: keyof typeof VARIANTS; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <img src={VARIANTS[variant]} alt="" width={224} height={224} loading="lazy"
        className="h-56 w-56 object-contain" />
      <p className="text-gray-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run components/ui`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/ui
git commit -m "feat: EmptyState 元件——四種空狀態插圖+文案"
```

---

### Task 5: 接上四處空狀態

**Files:**
- Modify: `components/watchlist/WatchlistView.tsx:123`
- Modify: `components/holdings/HoldingsView.tsx:66-68`
- Modify: `components/screener/ResultList.tsx`(新增無結果分支)
- Modify: `components/screener/ScreenerView.tsx:71`
- Modify: `components/strategy/StrategyView.tsx:51,88`

**Interfaces:**
- Consumes: Task 4 的 `EmptyState`

- [ ] **Step 1: 各檔替換**

WatchlistView(原 `{quotes.length === 0 && <p ...>還沒有自選股...}`):

```tsx
{quotes.length === 0 && <EmptyState variant="watchlist">還沒有自選股,用上面的搜尋框加入吧。</EmptyState>}
```

HoldingsView(原 `positions.length === 0` 的 `<p>`):

```tsx
{positions.length === 0 && (
  <EmptyState variant="holdings">還沒有持股紀錄,點上面「＋ 記一筆買賣」開始追蹤損益。</EmptyState>
)}
```

ResultList:`const shown = rows.slice(0, LIMIT);` 之後、回傳 JSX 內「手機:卡片」區塊前,於 `符合 N 檔` 列之下加:

```tsx
{rows.length === 0 && <EmptyState variant="screener">沒有符合條件的股票,放寬條件再找找。</EmptyState>}
```

ScreenerView 失敗態(原 `if (failed) return <p ...>暫無資料...`):

```tsx
if (failed) return <EmptyState variant="closed">暫無資料,稍後再試</EmptyState>;
```

StrategyView:失敗態同上;`recs.length === 0` 的 `<p>今日無符合條件的標的</p>` 改:

```tsx
{recs.length === 0 && <EmptyState variant="screener">今日無符合條件的標的</EmptyState>}
```

各檔加 `import EmptyState from "@/components/ui/EmptyState";`。

- [ ] **Step 2: 全套測試**

Run: `pnpm test`
Expected: 143 tests PASS(137 + Task 1 的 4 + Task 4 的 2;無既有測試引用被改文案)

- [ ] **Step 3: Commit**

```bash
git add components
git commit -m "feat: 四處空狀態接上插圖(自選/持股/選股/暫無資料)"
```

---

### Task 6: AppShell 品牌化 + 登入頁 + 驗證收尾

**Files:**
- Modify: `components/layout/AppShell.tsx`
- Modify: `app/login/page.tsx`

**Interfaces:**
- Consumes: Task 2 產出的 `/brand/logo.webp`、`/brand/logo-name.webp`、`/textures/header.webp`

- [ ] **Step 1: AppShell——logo + header 裝飾條**

```tsx
import BottomNav from "@/components/layout/BottomNav";
import SignOutButton from "@/components/SignOutButton";

export default function AppShell({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl pb-16 md:pb-0">
      <header className="relative flex items-center justify-between overflow-hidden border-b border-white/10 px-4 py-3">
        {/* 稜線裝飾:鏡像後光在右側,遠離左側標題 */}
        <img src="/textures/header.webp" alt="" aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 -scale-x-100 object-cover opacity-60" />
        <div className="relative flex items-center gap-2">
          <img src="/brand/logo.webp" alt="" width={24} height={24} className="h-6 w-6" />
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
        <div className="relative"><SignOutButton /></div>
      </header>
      <main className="p-4">{children}</main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 2: 登入頁——含字標 Logo**

```tsx
import SignInButton from "@/components/SignInButton";
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <img src="/brand/logo-name.webp" alt="Taidex 台股看板" width={288} height={288} className="w-72" />
      <p className="text-gray-400">用 LINE 登入,開始追蹤你的自選股</p>
      <SignInButton />
    </main>
  );
}
```

- [ ] **Step 3: 完整驗證門檻**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: 全綠

- [ ] **Step 4: 本機視覺驗證**

`pnpm dev` + 瀏覽器(E2E auth bypass cookie)檢查:登入頁 Logo、header 稜線與小 logo、自選股/持股/選股空狀態圖、頁面背景紋理不干擾數字、favicon 顯示。

- [ ] **Step 5: Commit + PR**

```bash
git add components/layout/AppShell.tsx app/login/page.tsx
git commit -m "feat: AppShell/登入頁品牌化——logo、稜線header裝飾、app icon"
git push -u origin feat/design-language
gh pr create --title "feat: 設計語言「金脈 Golden Ridge」UI 導入" --body "..."
```
