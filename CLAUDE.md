# CLAUDE.md

NazoDex（對外網域 **nazodex.nazo.com.tw**）——給投資新手（擁有者 Vincent 與太太）的台股看板 / 自選股工具。
設計哲學:**使用門檻低、操作上限高**（對使用者是乾淨的看盤網站,深度資訊漸進式揭露）。

## 指令

```bash
pnpm dev            # 本機開發
pnpm test           # Vitest（200 tests）
pnpm build          # Next.js standalone build
pnpm exec tsc --noEmit
pnpm exec prisma migrate dev --name <desc>   # 新增 schema 變更時產生 migration
pnpm ingest:daily   # 手動跑每日行情灌入（需可連 DB）
pnpm backfill:history  # 回填自選∪持股近 N 月日線(--months=N,預設 2;需可連 DB)
pnpm backfill:finmind   # FinMind 全市場 5 年日線回填(--years/--limit;需 FINMIND_TOKEN+DB)
pnpm ingest:fundamentals  # 月營收/季EPS 灌入(TWSE OpenAPI,K8s CronJob 每月 11/16 日;需可連 DB)
pnpm assets:prepare    # 設計素材管線:public/nazodex_assets/ 原始 PNG(gitignored)→ 透明化 WebP + app icon
```

- 套件管理用 **pnpm**（corepack, v11）。Node 22。TypeScript strict。
- 測試走 **TDD**：先寫失敗測試再實作。
- **開發流程**：未來任何功能開發，先從 `master` 建立分支（`feat/<desc>`），在分支上開發並通過完整測試（`pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`）後，才發 PR 合回 `master`。不直接 commit 到 `master`。

## 架構（單體 Next.js App Router 全端）

- **quote-service 抽象層** `lib/quotes/`：對前端只暴露「給我這些代號的報價/歷史」。
  - `quoteService.getQuotes()`：盤中打證交所 MIS（`misSource`）+ 30s 記憶體快取（`cache.memoize`）,盤後回 DB 收盤價（`dbSource`）;部分/失敗會回退 DB。盤中盤後由 `lib/market/hours.ts`（Asia/Taipei 平日 09:00–13:30）判斷。換源/加源只動這層。
- **認證** Auth.js v5 + LINE provider，**拆分設定**（見下方 auth 雷）。
- **自選股** `lib/watchlist/`：CRUD + 排序，**每個查詢都以 session userId 過濾**（跨使用者隔離,由 DB `@@unique([userId, stockSymbol])` 保證）。
- **持股損益** `lib/holdings/`：交易流水帳（`HoldingTransaction`）為唯一事實來源,部位/均價/已實現損益由 `positions.ts` 純函式以**平均成本法**即時推導（不存衍生狀態）;`service.ts` CRUD 皆以 userId 過濾並做超賣驗證;費用估算 `fees.ts`（手續費 0.1425% 低消 20、賣出稅 0.3%,表單可覆寫）。頁面 `/holdings`。交易型別除 BUY/SELL 外含 `DIV_CASH`（現金股利,累計 `dividendIncome`,與已實現損益分列）與 `DIV_STOCK`（配股:股數增、成本不變 → 均價稀釋;重放計入持股,刪單防超賣自動涵蓋）,零 migration（`side` 為 String）;費用缺省補值集中在 `fees.resolveFees`（股利匯費預設 10、健保補充費 2.11% 門檻 2 萬）。
- **大盤總覽** `lib/market-overview/`：指數（MIS `t00`/`o00`,盤中即時 30s 快取）、漲跌家數與三大法人（TWSE rwd JSON）、強弱產業（TWSE OpenAPI `MI_INDEX` 類指數）,全免費源、無 DB 表,每日資料 10min 快取;`service.getMarketOverview()` 區塊獨立容錯（單源失敗回 null）。頁面 `/market`,每日區塊標資料日期（盤中為前一交易日）。指數區塊由 `getIndices()` 抽出重用,首頁 `IndexBar`（`/api/market/indices`）與 `/market` 共用同一份指數資料。大盤 K 線（`indexHistory.ts`）:TWSE `MI_5MINS_HIST`（加權）+ TPEX `indexInfo/inx`（櫃買）按月抓取合併（300ms 節流;限流回應拋錯不快取,避免缺月的洞）,`/api/market/history?index=twse|tpex&months=1..6`,前端 `IndexKline` 蠟燭圖切換指數/範圍。
- **條件選股** `lib/screener/`：TWSE OpenAPI `STOCK_DAY_ALL`(價量) + `BWIBBU_ALL`(本益比/殖利率/淨值比) 以 Code 在記憶體 join 成快照(`service.getScreenerSnapshot()`,10min 快取,估值源失敗只讓估值欄為 null);**整包快照下發、前端過濾排序**(`engine.ts` 純函式:`applyConditions`/`sortRows`/`PRESETS` 高殖利率·便宜好股·今日強勢/`CONDITION_DEFS` 條件面板六列)。無 DB 表。頁面 `/screener`,標資料日期(盤中為前一交易日)。
- **策略推薦** `lib/strategy/`:六因子(價值/收息/動能/籌碼/熱度/成長)截面百分位評分,
  資料源=screener 快照+月均價(`STOCK_DAY_AVG_ALL`)+每股法人買賣超(rwd `T86`,不帶 date 取最新)+月營收 YoY(自 `MonthlyRevenue` 表,見下方基本面),
  `service.getStrategySnapshot()` 10min 快取、月均/T86/月營收 失敗對應因子 null(容錯);
  百分位/加權計分為前端計分純函式(`engine.ts`,於 Vitest/Node 測試;評分宇宙 ≥200 張且 ≥5 元、缺因子權重再正規化、<3 因子或主因子(最高權重)缺值不進榜),
  前端整包快照下發、調權重即時重排;預設策略新增「成長飛輪」。頁面 `/strategy`,無 DB 表。
- **基本面**(月營收/季 EPS):`MonthlyRevenue`/`QuarterlyEps` 表,`lib/ingest/twseFundamentals.ts` 解析 TWSE OpenAPI(`t187ap05_L` 月營收、`t187ap14_L` 季 EPS),`scripts/ingest-fundamentals.ts`(`pnpm ingest:fundamentals`)灌入,upsert 冪等(公司更正申報時官方值會變、重跑覆寫);策略推薦第六因子(成長)的 YoY 資料源即來自此表;個股頁 `components/stock/FundamentalsSection.tsx` server 直讀 DB 呈現。
- **每日行情** `scripts/ingest-daily.ts`（image 內編成 `dist/ingest-daily.mjs`）由 K8s CronJob 每日 15:00 台北灌入;TWSE(上市)+TPEX(上櫃)雙源獨立容錯(單源失敗不影響另一源),每月 1 日額外用 FinMind 刷新股票宇宙(市場別/產業別)。
- **FinMind client 層** `lib/finmind/`：節流(600 calls/hr)/限流退避/錯誤分類,只走 script/cron 路徑不進使用者請求;`scripts/backfill-finmind.ts`（`pnpm backfill:finmind`）用它做全市場 5 年日線回填,斷點續跑 + `skipDuplicates` 冪等。
- **前端**：手機卡片 / 電腦表格響應式（`components/watchlist/`）,每 60s 輪詢;個股頁 `app/stock/[symbol]` 用 lightweight-charts 畫 K 線。
- **設計語言**「金脈 Golden Ridge」（稜線=走勢比喻,spec 見下）:品牌金 token、`components/ui/EmptyState.tsx`（watchlist/holdings/screener/closed 四 variant 空狀態插圖）、素材管線 `scripts/prepare-assets.mjs`（亮度轉 alpha 去背 + 邊緣淡出,純函式 `asset-pipeline.lib.mjs` 有測試）。

## 慣例（勿違反）

- **紅漲綠跌**（台股慣例,與歐美相反）。顏色集中在 CSS 變數 `--up`(紅)/`--down`(綠) 與 `lib/format.ts` 的 `changeColorClass`;元件不得寫死 hex。Tailwind `content` 已含 `./lib/**`（否則 `text-down` 會被 purge）。
- 品牌金 `--brand: #f59e0b` / `--brand-bright: #fbbf24`（Tailwind `brand`/`brand-bright`）——品牌與素材一律避開紅綠,留給漲跌語意。
- 背景紋理放 `html` 不放 `body`（html 有背景時 body 背景不會傳播到畫布,短頁面下緣會露黑帶）;勿用 `background-attachment: fixed`（iOS 不可靠）。
- **iOS safe area**：viewport 已設 `viewportFit: "cover"`,固定在底部的元素（如 BottomNav）必須墊 `env(safe-area-inset-bottom)`——否則 LIFF 的 WKWebView 底部露白條、tab 被 Home Indicator 壓到（2026-07-05 iPhone 實機發現）。
- 價格顯示用 `lib/format.ts`（`fmtPrice`/`fmtSignedPct`）。
- 免費資料源：MIS（盤中）、證交所/櫃買 OpenAPI（每日）、FinMind（歷史回填/宇宙/除權息,`FINMIND_TOKEN`）。

## 認證雷（已修,務必維持）

1. `User` model **必須保留 `emailVerified DateTime?`**——Auth.js Prisma adapter 建立 User 時會寫入;少了它每次 LINE 登入都在 `createUser` 失敗。
2. 認證是**拆分設定 + JWT session**：
   - `auth.config.ts`：無 Prisma、edge-safe，供 `middleware.ts` 使用。
   - `auth.ts`：spread authConfig 再加 `PrismaAdapter` + `session.strategy: "jwt"`，供 Node runtime（route handler / server component）。
   - **絕不可**把 Prisma adapter 或 database session 放進 middleware 路徑——middleware 在 **Edge runtime** 執行,Prisma 不能在那跑,會導致每個請求失敗、登入後被彈回 /login。
3. **middleware matcher 必須排除靜態素材**（現為 `icon.png|brand/|empty/|textures/`）——否則未登入請求被 302 到 /login,登入頁自己的 Logo/背景載不出。**dev 的 Turbopack 不讓 public/ 檔過 middleware,此類問題只在 prod 出現**,要用 `pnpm build && pnpm start` 驗證;新增 public/ 子目錄或 metadata 圖檔時同步更新排除清單（2026-07-05 prod 踩雷）。

## 資料庫 / Migration

- Prisma + **Cloud SQL MySQL 8**。`schema.prisma` 的 datasource provider 為 `mysql`，用 `env("DATABASE_URL")`。
- Migration 檔在 `prisma/migrations/`，**已 commit**。部署時 K8s Deployment 的 initContainer 每次 rollout 自動跑 `prisma migrate deploy`（只往前、非破壞性）。新增欄位/表：`prisma migrate dev --name <desc>` 產生 migration 檔並提交。

## 部署（無 CI，本機滾動更新）

- 以 `nazodex` 租戶跑在 `~/devsecops-nazo` 的 GKE 平台（project `frozenheart`,cluster `ecommerce-cluster`）。
- 更新流程:改完 code →（在 `~/devsecops-nazo`）跑 `bash kubernetes/tenants/nazodex/build-init.sh`（首次）或 `build-update.sh`（日常）→ 內含 build+push image + `make deploy nazodex`。
- LINE Login channel `1654117392`,LIFF 入口 `/liff`（`LIFF_ID` 由 configmap runtime 讀取,入口網址 `https://liff.line.me/1654117392-BKWVcPBa`）。callback:`https://nazodex.nazo.com.tw/api/auth/callback/line`。
- 對外 TLS 由 Cloudflare（Flexible SSL）處理,origin 走 HTTP;故 NextAuth 用 `AUTH_URL=https://nazodex.nazo.com.tw` + `AUTH_TRUST_HOST=true`。

## 規格 / 計畫文件

- 看盤/自選股:`docs/superpowers/specs/2026-07-02-nazodex-watchlist-design.md` + `docs/superpowers/plans/2026-07-02-nazodex-watchlist.md`
- 持股損益:`docs/superpowers/specs/2026-07-03-nazodex-holdings-design.md` + `docs/superpowers/plans/2026-07-03-nazodex-holdings.md`;股利/除權息:`docs/superpowers/specs/2026-07-03-nazodex-dividends-design.md` + `docs/superpowers/plans/2026-07-03-nazodex-dividends.md`
- 大盤總覽:`docs/superpowers/specs/2026-07-03-nazodex-market-overview-design.md`
- 條件選股:`docs/superpowers/specs/2026-07-03-nazodex-screener-design.md` + `docs/superpowers/plans/2026-07-03-nazodex-screener.md`
- 設計語言:`docs/superpowers/specs/2026-07-05-nazodex-design-language.md`（含 AI 生圖提示詞）+ `docs/superpowers/plans/2026-07-05-nazodex-design-language.md`
- 新聞/事件方向:`docs/superpowers/specs/2026-07-05-nazodex-news-events-direction.md`（方向討論記錄,含波動四層模型、M1–M4 milestone、YAGNI 界線;非實作規格）

## 路線圖

「看盤 / 自選股」「持股損益追蹤」「大盤與產業總覽」「條件選股」已上線（全用 TWSE 免費源,未用到 FinMind）。後續（依價值）:
1. 持股損益延伸:股利/除權息已上線(2026-07-03,手動記帳;自動抓除權息預填仍為 YAGNI),剩報表圖表。
2. 大盤延伸:上櫃漲跌家數/法人、產業下鑽(v1 刻意不做,見 spec 的 YAGNI 節);大盤 K 線已上線(2026-07-03)。
3. 選股延伸:策略推薦(多因子評分)已上線(2026-07-03),第六因子「成長」(月營收 YoY)與個股頁基本面區塊已上線(2026-07-09,TWSE OpenAPI 源);上櫃股票、技術指標(等 DailyQuote 歷史累積,約 2026-10 起可做均線)、產業別篩選、儲存自訂策略(v1 刻意不做,見 spec 的 YAGNI 節)。
4. 新聞/事件(2026-07-05 定向,見上方方向文件):M1 官方事件層(MOPS 重大訊息+注意/處置股)→ M2 個股新聞牆(RSS)→ M3 LLM 知識標籤 → M4 新聞×籌碼對照。定位是「呈現給人做判斷」,**不進評分引擎**(無法回測)。

v1 polish 全數完成(2026-07-03):拖曳排序、盤後標示、成交量統一、AddStock debounce、選股一鍵加自選、大盤指數列(首頁,`/api/market/indices`)+ 卡片迷你走勢線(近月收盤,`/api/watchlist/sparklines`;歷史以 `pnpm backfill:history` 回填自選∪持股近 2 月,新自選靠每日 ingest 累積)。

設計語言「金脈 Golden Ridge」已上線(2026-07-05,PR #1/#2):品牌識別、空狀態插圖、背景紋理、iOS safe area 全數導入 prod。
