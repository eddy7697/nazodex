<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-name.webp">
    <img src="public/brand/logo.webp" width="220" alt="NazoDex">
  </picture>
</p>

# NazoDex — 台股看板與自選股工具

> 對外網址：[**nazodex.nazo.com.tw**](https://nazodex.nazo.com.tw)（LINE 登入，亦可由 [LIFF 入口](https://liff.line.me/1654117392-BKWVcPBa)進入）

NazoDex 是一個為**投資新手**打造的台股看盤網站。設計哲學是「**使用門檻低、操作上限高**」——打開就是一個乾淨好懂的看盤介面，深度資訊（估值、法人籌碼、多因子評分）採漸進式揭露，不會一開始就把新手淹沒在數字裡；但當使用者成長後，工具的上限也跟得上。

全站資料**只使用免費公開資料源**（證交所 MIS、TWSE / TPEX OpenAPI），沒有任何付費行情授權，也因此適合個人與家庭自架使用。

---

## 目錄

- [功能總覽](#功能總覽)
  - [1. 自選股看盤（首頁）](#1-自選股看盤首頁)
  - [2. 個股頁與 K 線](#2-個股頁與-k-線)
  - [3. 持股損益追蹤](#3-持股損益追蹤)
  - [4. 股利與除權息記帳](#4-股利與除權息記帳)
  - [5. 大盤與產業總覽](#5-大盤與產業總覽)
  - [6. 條件選股](#6-條件選股)
  - [7. 策略推薦（多因子評分）](#7-策略推薦多因子評分)
  - [8. 帳號與登入](#8-帳號與登入)
- [設計語言](#設計語言)
- [設計慣例](#設計慣例)
- [系統架構](#系統架構)
- [資料源與更新機制](#資料源與更新機制)
- [技術棧](#技術棧)
- [開發](#開發)
- [部署](#部署)
- [未來展望](#未來展望)

---

## 功能總覽

### 1. 自選股看盤（首頁）

首頁即自選股清單，是整個產品的核心動線：

- **即時報價**：盤中（平日 09:00–13:30，台北時間）每 60 秒輪詢證交所 MIS 即時行情；盤後自動切換為資料庫收盤價，並清楚標示「盤後」狀態，不會讓人誤以為是即時價。
- **響應式雙版型**：手機是卡片式排版（單手可操作），電腦是資訊密度較高的表格，同一份資料兩種閱讀方式。
- **迷你走勢線（sparkline）**：每張卡片 / 每列附近一個月收盤走勢縮圖，一眼看出趨勢，不必點進個股頁。
- **拖曳排序**：長按拖曳（dnd-kit）自訂自選股順序，排序存回伺服器、跨裝置一致。
- **加自選搜尋**：輸入代號或名稱即時搜尋（含 debounce），支援從條件選股頁一鍵加入。
- **大盤指數列**：頁面頂部常駐加權指數與櫃買指數的即時漲跌，與大盤總覽頁共用同一份資料。
- **跨使用者隔離**：每一筆自選股查詢都以登入者的 userId 過濾，並由資料庫唯一鍵約束保證，不同使用者的清單完全獨立。

### 2. 個股頁與 K 線

- 路由 `/stock/[symbol]`，以 lightweight-charts 繪製日 K 蠟燭圖。
- 歷史日線來自每日自動灌入的 `DailyQuote` 資料表；新加入自選的股票由每日排程累積，也可用 `pnpm backfill:history` 回填近 N 個月。

### 3. 持股損益追蹤

頁面 `/holdings`。核心設計是「**交易流水帳為唯一事實來源**」：

- 使用者記錄每一筆買進 / 賣出（`HoldingTransaction`），部位、平均成本、已實現損益全部由純函式以**平均成本法**即時推導，**不儲存任何衍生狀態**——因此改單、刪單永遠不會讓帳目失真，重放一次流水帳就是正確答案。
- **費用估算**：手續費 0.1425%（低消 20 元）、賣出證交稅 0.3%，表單自動帶入、可手動覆寫（例如有券商折讓時）。
- **超賣驗證**：賣出股數不得超過當下持有股數，新增與刪除交易時都會重放驗證，防止帳目出現負持股。
- **未實現損益**：持有部位搭配即時報價（同一套 quote-service）計算現值與未實現損益，紅漲綠跌一目瞭然。

### 4. 股利與除權息記帳

持股功能的延伸，零 schema migration 即上線：

- **現金股利（`DIV_CASH`）**：累計為「股利收入」，與買賣價差的已實現損益**分列呈現**——存股族看得到自己真正的現金流。
- **股票股利 / 配股（`DIV_STOCK`）**：股數增加、總成本不變，平均成本自動稀釋；配股一樣進入流水帳重放，超賣防護自動涵蓋。
- **股利費用**：匯費預設 10 元、二代健保補充保費 2.11%（單筆 2 萬門檻）自動判斷補值，皆可覆寫。

### 5. 大盤與產業總覽

頁面 `/market`，回答「今天大盤怎麼了？」這個新手最常問的問題：

- **指數**：加權指數（TWSE）與櫃買指數（TPEX）盤中即時（30 秒快取）。
- **大盤 K 線**：加權 / 櫃買日 K 蠟燭圖，可切換指數與 1–6 個月範圍；按月抓取合併並節流，遇上游限流即拋錯不快取，避免圖上出現缺月的洞。
- **漲跌家數**：上市漲 / 跌 / 平家數，體感市場寬度。
- **三大法人買賣超**：外資、投信、自營商當日金額。
- **強弱產業**：以 TWSE 類股指數列出當日最強與最弱產業。
- **獨立容錯**：每個區塊獨立抓取，單一資料源掛掉只影響該區塊（顯示為無資料），整頁不會白屏；每日資料明確標示資料日期（盤中顯示的是前一交易日）。

### 6. 條件選股

頁面 `/screener`，架構上刻意選擇「**整包快照下發、前端過濾排序**」：

- 後端把全市場價量（`STOCK_DAY_ALL`）與估值（`BWIBBU_ALL`：本益比 / 殖利率 / 股價淨值比）在記憶體 join 成一份快照（10 分鐘快取），一次下發前端。
- 前端過濾 / 排序是純函式——**調整條件即時反應、零網路延遲**，滑桿拉到哪結果跳到哪。
- **六大條件**：價格區間、漲跌幅、成交量、本益比、殖利率、股價淨值比。
- **預設策略（presets）**：「高殖利率」「便宜好股」「今日強勢」一鍵套用，新手不用先懂每個欄位是什麼。
- **一鍵加自選**：選股結果直接加入自選股，動線閉環。
- 估值源失敗時只讓估值欄位為 null，價量篩選照常可用。

### 7. 策略推薦（多因子評分）

頁面 `/strategy`，選股的進階形態——從「自己設條件」進化到「告訴我該看哪些股票」：

- **六因子模型**：價值（估值便宜）、收息（殖利率）、動能（價格趨勢，用月均價）、籌碼（法人買賣超，rwd `T86`）、熱度（成交活躍度）、**成長**（月營收年增率，來自 `MonthlyRevenue`），對全市場做**截面百分位評分**後加權合成總分。
- **策略 chips**：預設多組權重配方（如存股收息、動能追強、成長飛輪），點一下即切換；也可打開權重面板自行調配，**調整權重即時重排**（計分是前端純函式，在 Vitest/Node 下完整測試）。
- **推薦卡片**：每檔顯示因子條與入選理由，讓使用者知道「為什麼是它」，而不是黑箱給名單。
- **嚴謹的進榜規則**：評分宇宙限市值型雜訊過濾（成交 ≥200 張且股價 ≥5 元）、缺因子時權重再正規化、少於 3 個因子或**主因子（最高權重）缺值不進榜**——存股收息榜上不會出現沒有殖利率的股票。
- 資料源容錯：月均價或法人資料失敗時，對應因子整欄為 null，其餘因子照常評分。

### 8. 帳號與登入

- **LINE Login**（Auth.js v5 + LINE provider），對台灣家庭使用者最自然的登入方式，免記密碼。
- **LIFF 入口**：可直接從 LINE App 內開啟，行動端體驗如同原生。
- JWT session + 拆分設定（edge-safe 的 `auth.config.ts` 供 middleware、含 Prisma adapter 的 `auth.ts` 供 Node runtime），細節與踩雷紀錄見 `CLAUDE.md`。

---

## 設計語言

視覺系統「**金脈 Golden Ridge**」——核心比喻是**台灣山脈稜線＝行情走勢**：上升的稜線既是 K 線，也是台灣的山。深色底、琥珀金主色（`--brand: #f59e0b` → `--brand-bright: #fbbf24`），紅綠完全保留給漲跌語意。從 Logo、空狀態插圖到頁面背景的等高線地形紋，全部出自同一個比喻。

| 還沒有自選股 | 還沒有持股 | 選股無結果 | 休市 / 暫無資料 |
|:---:|:---:|:---:|:---:|
| <img src="public/empty/watchlist.webp" width="150" alt=""> | <img src="public/empty/holdings.webp" width="150" alt=""> | <img src="public/empty/screener.webp" width="150" alt=""> | <img src="public/empty/market-closed.webp" width="150" alt=""> |

素材由 AI 生成（提示詞見 `docs/superpowers/specs/2026-07-05-nazodex-design-language.md`），經 `pnpm assets:prepare` 管線處理：**亮度轉 alpha**（發光線條去背，可浮在任何深色上）＋ 邊緣淡出 ＋ 分類輸出 WebP。像素轉換是有單元測試的純函式（`scripts/asset-pipeline.lib.mjs`）。

## 設計慣例

- **紅漲綠跌**（台股慣例，與歐美相反）。顏色集中在 CSS 變數 `--up`（紅）/ `--down`（綠）與 `lib/format.ts` 的 `changeColorClass`，元件不得寫死色碼。
- 價格與百分比顯示統一走 `lib/format.ts`（`fmtPrice` / `fmtSignedPct`）。
- 手機禁止雙擊 / 兩指縮放（viewport meta + `touch-action: manipulation`），看盤時不會誤觸放大。
- 每日性資料一律標示**資料日期**，盤中顯示的每日資料明示為前一交易日。

---

## 系統架構

單體 Next.js（App Router）全端應用，前後端同倉同部署：

```
app/                    # 頁面與 API routes
├── page.tsx            # 首頁＝自選股看盤
├── stock/[symbol]/     # 個股頁（K 線）
├── holdings/           # 持股損益
├── market/             # 大盤總覽
├── screener/           # 條件選股
├── strategy/           # 策略推薦
├── liff/               # LINE LIFF 入口
└── api/                # watchlist / holdings / market / screener / strategy / stocks / auth

lib/                    # 領域邏輯（皆有 Vitest 測試，全倉共 200 tests）
├── quotes/             # quote-service 抽象層（MIS 盤中 + DB 盤後，30s 快取與回退）
├── market/hours.ts     # 台股交易時段判斷（Asia/Taipei 平日 09:00–13:30）
├── watchlist/          # 自選股 CRUD + 排序（userId 隔離）
├── holdings/           # 交易流水帳、平均成本法推導、費用估算
├── market-overview/    # 指數 / 漲跌家數 / 法人 / 產業 / 大盤 K 線
├── screener/           # 快照 join + 前端過濾排序純函式
├── strategy/           # 六因子截面百分位評分
└── ingest/             # 每日行情灌入

scripts/ingest-daily.ts # K8s CronJob 每日 15:00 灌入收盤行情
prisma/                 # schema + migrations（已 commit，部署時自動 migrate deploy）
```

架構上最重要的一個決策是 **quote-service 抽象層**（`lib/quotes/`）：前端只知道「給我這些代號的報價 / 歷史」，盤中打 MIS、盤後讀 DB、失敗回退，全部封裝在這一層。未來要換資料源或加付費源，只動這一層，所有頁面無感。

## 資料源與更新機制

| 資料 | 來源 | 更新方式 |
|---|---|---|
| 盤中即時報價 / 指數 | 證交所 MIS | 盤中即時，30 秒記憶體快取 |
| 每日收盤行情 | TWSE（上市）+ TPEX（上櫃）OpenAPI | K8s CronJob 每日 15:00 灌入 DB,雙源獨立容錯 |
| 歷史回填 / 股票宇宙 / 除權息 | FinMind（需 `FINMIND_TOKEN`） | `pnpm backfill:finmind` 手動全市場回填;每月 1 日 ingest 自動刷新宇宙 |
| 估值（PE / 殖利率 / PB） | TWSE `BWIBBU_ALL` | 10 分鐘快取 |
| 漲跌家數 / 三大法人 | TWSE rwd JSON | 10 分鐘快取 |
| 產業強弱 | TWSE `MI_INDEX` 類指數 | 10 分鐘快取 |
| 大盤歷史 K 線 | TWSE `MI_5MINS_HIST` + TPEX `indexInfo/inx` | 按月抓取合併、300ms 節流 |
| 月均價 / 法人買賣超 | TWSE `STOCK_DAY_AVG_ALL` / rwd `T86` | 10 分鐘快取 |
| 月營收 / 季 EPS（基本面） | TWSE `t187ap05_L` / `t187ap14_L` | `pnpm ingest:fundamentals` 定期灌入 DB |

全部免費（FinMind 需申請免費 `FINMIND_TOKEN`，其餘無 API key）。各區塊獨立容錯：單一來源失敗只讓對應欄位或區塊降級，不影響整頁。

## 技術棧

- **框架**：Next.js 16（App Router、standalone build）+ React 19 + TypeScript strict
- **認證**：Auth.js v5（next-auth beta）+ LINE provider + LIFF
- **資料庫**：Prisma 6 + Cloud SQL for MySQL 8
- **UI**：Tailwind CSS、dnd-kit（拖曳排序）、lightweight-charts（K 線）
- **測試**：Vitest（200 tests），開發流程走 **TDD**（先寫失敗測試再實作）
- **套件管理**：pnpm（corepack）、Node 22

## 開發

```bash
pnpm install
pnpm dev                 # http://localhost:3000
pnpm test                # Vitest 全跑
pnpm exec tsc --noEmit   # 型別檢查
pnpm build               # 產線 build（standalone）

# 資料工具（需可連 DB）
pnpm ingest:daily        # 手動跑每日行情灌入
pnpm backfill:history    # 回填自選∪持股近 N 月日線（--months=N，預設 2）
pnpm backfill:finmind    # FinMind 全市場 5 年日線回填（--years/--limit；需 FINMIND_TOKEN）
pnpm ingest:fundamentals # 月營收/季EPS 灌入（TWSE OpenAPI；需可連 DB）

# 設計素材（來源 PNG 放 public/nazodex_assets/，不進 repo）
pnpm assets:prepare      # 透明化+邊緣淡出+分類輸出 WebP 與 app icon

# schema 變更
pnpm exec prisma migrate dev --name <desc>
```

環境變數：`DATABASE_URL`、`AUTH_SECRET`、LINE channel 憑證、`AUTH_URL` + `AUTH_TRUST_HOST=true`（origin 走 HTTP、TLS 由 Cloudflare 終結），LIFF ID 由 configmap 於 runtime 讀取。

## 部署

無 CI，本機滾動更新：以 `nazodex` 租戶跑在自架 GKE 平台（`~/devsecops-nazo`）。

1. 改完 code、測試通過。
2. 在 `~/devsecops-nazo` 執行 `bash kubernetes/tenants/nazodex/build-update.sh`（首次部署用 `build-init.sh`）——內含 build + push image + `make deploy nazodex`。
3. Deployment 的 initContainer 每次 rollout 自動跑 `prisma migrate deploy`（只往前、非破壞性）。
4. 每日行情由 K8s CronJob（15:00 Asia/Taipei）執行 image 內的 `dist/ingest-daily.mjs`。

---

## 未來展望

v1（看盤 / 自選股、持股損益、大盤總覽、條件選股、策略推薦與全部 polish 項目）已於 2026-07-03 全數上線。以下依價值排序的後續方向，多數已在各 spec 的 YAGNI 節記錄過「為什麼 v1 刻意不做」，等待對應的前置條件成熟：

### 近期（資料已齊，只差實作）

1. **持股報表與圖表**：持股流水帳資料已完整（含股利），下一步是視覺化——資產配置圓餅圖、月度已實現損益 / 股利收入長條圖、累計報酬曲線。讓「記了這麼多帳」變成「看得到的成果」，對存股族尤其有感。
2. **上櫃（TPEX）股票納入選股與策略**：目前條件選股與策略推薦只涵蓋上市（TWSE）。TPEX 有對應的免費 OpenAPI，納入後選股宇宙翻倍；quote-service 抽象層已為多源設計，主要工作在快照 join 與代號歸屬。
3. **大盤總覽延伸**：上櫃漲跌家數與法人買賣超（目前只有上市）、產業下鑽（點強弱產業看成分股表現）。

### 中期（等資料累積）

4. **技術指標**：均線（MA5/20/60）、KD、MACD 疊加在個股 K 線上。前置條件是 `DailyQuote` 歷史累積——每日 ingest 自 2026-07 起累積，**約 2026-10 起**即有足夠日線算 60 日均線。屆時也可回饋策略推薦的動能因子（用自家歷史取代月均價 API）。
5. **產業別篩選**：條件選股加入產業維度（「只看金融股裡的高殖利率」），需要建立並維護個股↔產業對照。
6. **儲存自訂策略**：策略推薦的權重配方目前是 session 內即調即用；下一步讓使用者把自己調出來的配方存起來（需新增 DB 表），並可設為預設 chips。

### 長期（新能力）

7. **除權息行事曆與自動預填**：目前股利記帳是手動輸入（v1 判定自動抓取為 YAGNI）。長期可接 TWSE 除權息公告，對持股自動產生待確認的股利交易草稿——記帳從「主動記」變成「按一下確認」。
8. **基本面資料（月營收 / 季 EPS）已上線（2026-07-09）**：月營收與季 EPS 改用 TWSE OpenAPI（`t187ap05_L` / `t187ap14_L`，非 FinMind）灌入 `MonthlyRevenue` / `QuarterlyEps` 表，成為策略推薦的第六因子「成長」（月營收年增率），並在個股頁新增基本面區塊。FinMind 仍只用於歷史回填/股票宇宙/除權息；財報等更深入基本面尚未串接。
9. **到價 / 事件通知**：既然登入即是 LINE，天然適合走 LINE Notify / Messaging API 推播——自選股到價提醒、持股除權息前提醒、策略榜單異動摘要。這會把 NazoDex 從「主動打開看」升級為「重要時刻找上門」。
10. **多市場**：quote-service 的「換源 / 加源只動這一層」設計，理論上可延伸美股或 ETF 專區——但這超出「給家人用的台股工具」的初衷，除非真實需求出現，否則維持 YAGNI。

### 不變的原則

無論功能怎麼長，三件事不會變：

- **免費資料源優先**——個人自架的成本底線。
- **使用門檻低、操作上限高**——新功能一律預設收合 / 漸進揭露，首頁永遠是乾淨的看盤清單。
- **TDD 與純函式核心**——計分、損益推導、過濾排序全部是可在 Node 下測試的純函式，UI 只是這些函式的殼。
