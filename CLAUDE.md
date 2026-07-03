# CLAUDE.md

Taidex（對外網域 **tradex.nazo.com.tw**）——給投資新手（擁有者 Vincent 與太太）的台股看板 / 自選股工具。
設計哲學:**使用門檻低、操作上限高**（對使用者是乾淨的看盤網站,深度資訊漸進式揭露）。

## 指令

```bash
pnpm dev            # 本機開發
pnpm test           # Vitest（33 tests）
pnpm build          # Next.js standalone build
pnpm exec tsc --noEmit
pnpm exec prisma migrate dev --name <desc>   # 新增 schema 變更時產生 migration
pnpm ingest:daily   # 手動跑每日行情灌入（需可連 DB）
```

- 套件管理用 **pnpm**（corepack, v11）。Node 22。TypeScript strict。
- 測試走 **TDD**：先寫失敗測試再實作。

## 架構（單體 Next.js App Router 全端）

- **quote-service 抽象層** `lib/quotes/`：對前端只暴露「給我這些代號的報價/歷史」。
  - `quoteService.getQuotes()`：盤中打證交所 MIS（`misSource`）+ 30s 記憶體快取（`cache.memoize`）,盤後回 DB 收盤價（`dbSource`）;部分/失敗會回退 DB。盤中盤後由 `lib/market/hours.ts`（Asia/Taipei 平日 09:00–13:30）判斷。換源/加源只動這層。
- **認證** Auth.js v5 + LINE provider，**拆分設定**（見下方 auth 雷）。
- **自選股** `lib/watchlist/`：CRUD + 排序，**每個查詢都以 session userId 過濾**（跨使用者隔離,由 DB `@@unique([userId, stockSymbol])` 保證）。
- **持股損益** `lib/holdings/`：交易流水帳（`HoldingTransaction`）為唯一事實來源,部位/均價/已實現損益由 `positions.ts` 純函式以**平均成本法**即時推導（不存衍生狀態）;`service.ts` CRUD 皆以 userId 過濾並做超賣驗證;費用估算 `fees.ts`（手續費 0.1425% 低消 20、賣出稅 0.3%,表單可覆寫）。頁面 `/holdings`。
- **每日行情** `scripts/ingest-daily.ts`（image 內編成 `dist/ingest-daily.mjs`）由 K8s CronJob 每日 15:00 台北灌入。
- **前端**：手機卡片 / 電腦表格響應式（`components/watchlist/`）,每 60s 輪詢;個股頁 `app/stock/[symbol]` 用 lightweight-charts 畫 K 線。

## 慣例（勿違反）

- **紅漲綠跌**（台股慣例,與歐美相反）。顏色集中在 CSS 變數 `--up`(紅)/`--down`(綠) 與 `lib/format.ts` 的 `changeColorClass`;元件不得寫死 hex。Tailwind `content` 已含 `./lib/**`（否則 `text-down` 會被 purge）。
- 價格顯示用 `lib/format.ts`（`fmtPrice`/`fmtSignedPct`）。
- 免費資料源：MIS（盤中）、證交所/櫃買 OpenAPI（每日）、FinMind（基本面,未來）。

## 認證雷（已修,務必維持）

1. `User` model **必須保留 `emailVerified DateTime?`**——Auth.js Prisma adapter 建立 User 時會寫入;少了它每次 LINE 登入都在 `createUser` 失敗。
2. 認證是**拆分設定 + JWT session**：
   - `auth.config.ts`：無 Prisma、edge-safe，供 `middleware.ts` 使用。
   - `auth.ts`：spread authConfig 再加 `PrismaAdapter` + `session.strategy: "jwt"`，供 Node runtime（route handler / server component）。
   - **絕不可**把 Prisma adapter 或 database session 放進 middleware 路徑——middleware 在 **Edge runtime** 執行,Prisma 不能在那跑,會導致每個請求失敗、登入後被彈回 /login。

## 資料庫 / Migration

- Prisma + **Cloud SQL MySQL 8**。`schema.prisma` 的 datasource provider 為 `mysql`，用 `env("DATABASE_URL")`。
- Migration 檔在 `prisma/migrations/`，**已 commit**。部署時 K8s Deployment 的 initContainer 每次 rollout 自動跑 `prisma migrate deploy`（只往前、非破壞性）。新增欄位/表：`prisma migrate dev --name <desc>` 產生 migration 檔並提交。

## 部署（無 CI，本機滾動更新）

- 以 `tradex` 租戶跑在 `~/devsecops-nazo` 的 GKE 平台（project `frozenheart`,cluster `ecommerce-cluster`）。
- 更新流程:改完 code →（在 `~/devsecops-nazo`）跑 `bash kubernetes/tenants/tradex/build-init.sh`（首次）或 `build-update.sh`（日常）→ 內含 build+push image + `make deploy tradex`。
- LINE Login channel `1654117392`,LIFF 入口 `/liff`（`LIFF_ID` 由 configmap runtime 讀取,入口網址 `https://liff.line.me/1654117392-BKWVcPBa`）。callback:`https://tradex.nazo.com.tw/api/auth/callback/line`。
- 對外 TLS 由 Cloudflare（Flexible SSL）處理,origin 走 HTTP;故 NextAuth 用 `AUTH_URL=https://tradex.nazo.com.tw` + `AUTH_TRUST_HOST=true`。

## 規格 / 計畫文件

- 看盤/自選股:`docs/superpowers/specs/2026-07-02-taidex-watchlist-design.md` + `docs/superpowers/plans/2026-07-02-taidex-watchlist.md`
- 持股損益:`docs/superpowers/specs/2026-07-03-taidex-holdings-design.md` + `docs/superpowers/plans/2026-07-03-taidex-holdings.md`

## 路線圖

「看盤 / 自選股」「持股損益追蹤」已上線。後續（依價值）:
1. **大盤與產業總覽**（指數、漲跌家數、三大法人、強弱產業,需接 FinMind）。
2. **條件選股**。
3. 持股損益延伸:股利/除權息、報表圖表（v1 刻意不做,見 spec 的 YAGNI 節）。

v1 尚未做的 polish（小項）:大盤指數列 + 卡片迷你走勢線、拖曳排序 UI（後端 API 已就緒）、盤後「資料延遲」標示（`Quote.asOf` 已有）、成交量單位統一（張 vs 股）、AddStock debounce。
