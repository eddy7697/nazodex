# Taidex 大盤指數列 + 卡片迷你走勢線 設計(v1 最後 polish)

日期:2026-07-03
狀態:已定稿(使用者授權自主執行,設計經自我審查)
來源:watchlist 原始 spec「頂端大盤加權指數一行」「卡片迷你當日走勢線」;CLAUDE.md v1 polish 清單最後一項。

## 目標

1. **大盤指數列**:自選股首頁(`/`)頂端顯示加權指數、櫃買指數的即時點位與漲跌幅,一眼掌握大盤;點擊導向 `/market`。
2. **卡片迷你走勢線**:自選股卡片(手機)與表格(桌機)顯示每檔「近月每日收盤」迷你走勢線,一眼看出趨勢。

## 關鍵決策與取捨

### 走勢線資料源:近月每日收盤(DailyQuote),不做盤中即時

原始 spec 寫「當日走勢線」,但:
- MIS 只回單點快照,無盤中時間序列;自行累積快照需常駐取樣(記憶體版 pod 重啟即斷、使用者中途開 app 只有殘缺線段)或新增 tick 資料表 + 每分鐘 CronJob——對 polish 項目過重。
- 近月收盤走勢對「投資新手看趨勢」同樣有效,且與個股頁 K 線(同為 DailyQuote 日線)一致。

**取捨後**:走勢線 = 近 30 個交易日收盤價 polyline。日後要做盤中版再立獨立 spec(見 YAGNI)。

### 歷史回填:讓走勢線上線即可用

DailyQuote 自 2026-07-02 才開始累積(每日 15:00 ingest),今天只有 1 個點,走勢線會空白數週。
新增一次性回填腳本:

- 資料源:TWSE rwd `STOCK_DAY`(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=YYYYMMDD&stockNo=XXXX&response=json`),單股單月日線,免費、無金鑰。
- **只回填 watchlist ∪ holdings 出現過的股票**(走勢線只在這些地方顯示),數十檔 × 近 2 個月 ≈ 數十個請求,節流 1.5s/請求,不會觸發 TWSE 封鎖。全市場回填(~1000 檔 × N 月)不做。
- 冪等 upsert(與 ingest 同 key `stockSymbol_date`),可重複執行。
- 新加入自選的股票不自動回填:先無走勢線,之後每日 ingest 自然累積;需要時手動重跑腳本即可(YAGNI:自動觸發回填)。

## 架構

### 1. 大盤指數列

- **服務層**:`lib/market-overview/service.ts` 匯出 `getIndices(): Promise<Quote[]>`,直接重用模組內既有 `cachedIndices`(30s memoize,與 `/market` 頁共享快取)。
- **API**:`GET /api/market/indices`(需登入,同其他 API)→ `{ indices: Quote[] }`。失敗回空陣列(區塊容錯,同 market-overview 精神)。
- **UI**:`components/watchlist/IndexBar.tsx`(client)——一列兩檔:名稱、點位(`fmtPrice`)、漲跌幅(`fmtSignedPct` + `changeColorClass`,紅漲綠跌)。60s 輪詢(與 WatchlistView 同頻)。取不到資料時整列隱藏,不擋看盤。整列為 `<Link href="/market">`。
- 掛載於 `app/page.tsx`,置於 `WatchlistView` 之上(AppShell 內)。

### 2. 迷你走勢線

- **純函式**:`lib/sparkline.ts` — `sparklinePoints(closes: number[], w, h, pad?): string`,把收盤序列 normalize 成 SVG polyline points 字串;全平序列置中畫水平線;<2 點回空字串。可單測。
- **服務層**:`lib/stocks/history.ts` 加 `getSparklines(symbols: string[], days = 30, p = prisma): Promise<Record<string, number[]>>` — 一次 `findMany`(`stockSymbol in`, 依 symbol+date 排序)分組,每檔取最近 `days` 筆收盤、日期升冪。
- **API**:`GET /api/watchlist/sparklines` — **不接受 query 參數**;server 端以 session userId 取自選清單 symbols 再查(維持跨使用者隔離慣例)→ `{ sparklines: Record<string, number[]> }`。
- **UI**:`components/watchlist/Sparkline.tsx` — 純展示 inline SVG(卡片 64×24、表格 80×24),`stroke` 依窗口首尾:漲 `var(--up)`、跌 `var(--down)`、平/資料不足灰;<2 點 render `null`(版位保留由父層決定)。不用圖表庫(lightweight-charts 留給個股頁)。
- **整合**:`WatchlistView` 於 mount 與清單增減後 fetch sparklines(每日資料,不需 60s 輪詢),以 `closes` prop 傳入 `QuoteCard`(名稱與價格之間)與 `QuoteRow`(新增「近月」欄)。prop 選填,無資料時外觀同現狀。

### 3. 歷史回填

- **解析層**:`lib/ingest/twseStockDay.ts` — fetch + parse `STOCK_DAY` rwd JSON:民國日期(`115/06/02`)→ ISO、千分位字串 → number、成交股數(股)→ BigInt volume(與 ingest 一致存「股」;`Quote` 顯示時由 dbSource 換算張)。`--` 等無效列跳過。純 parser 可單測。
- **腳本**:`scripts/backfill-history.ts` → build 出 `dist/backfill-history.mjs`(比照 ingest 打包);流程:DB 撈 `WatchlistItem` ∪ `HoldingTransaction` 的 distinct symbols → 每檔抓近 N 月(預設 2,`--months` 可調)→ 冪等 upsert DailyQuote → 每請求間隔 1.5s。日期一律 `new Date(\`${iso}T00:00:00Z\`)`(UTC 午夜,與 pod(UTC)ingest 的 `setHours(0,0,0,0)` 落點一致;實作時以 schema `@db.Date` 驗證)。
- **執行**:部署新 image 後在 app pod 內 `node dist/backfill-history.mjs` 跑一次。

## 錯誤處理

- 指數列:API 或上游失敗 → 空陣列 → UI 隱藏整列。
- 走勢線:API 失敗或某檔無資料 → 該檔不畫線,其餘照常。
- 回填:單月/單檔失敗記 log 續跑,結束時列出失敗清單;exit code 反映是否全成功。

## 測試(TDD)

| 單元 | 測試 |
|---|---|
| `lib/sparkline.ts` | 正規化座標、平線置中、<2 點回空、單調序列端點正確 |
| `getSparklines` | prisma mock:batch 分組、日期升冪、超過 days 截斷、無資料檔缺鍵 |
| `service.getIndices` | 重用 cachedIndices(注入 fetch/deps 驗證回傳) |
| `twseStockDay` parser | 民國日期轉換、千分位、`--` 無效列、欄位對映 |
| `Sparkline` 元件 | 漲紅/跌綠 stroke、<2 點 render null |
| `IndexBar` 元件 | mock fetch:顯示兩指數與紅綠色、失敗時隱藏 |
| 既有測試 | QuoteCard/QuoteRow 加選填 prop 不破壞既有測試 |

## YAGNI(明確不做)

- 盤中即時走勢線(需 tick 累積基礎設施,另立 spec)。
- 指數迷你走勢線(無指數歷史資料表)。
- 走勢線 tooltip / 互動、時間軸刻度。
- 全市場歷史回填、新增自選自動回填。
- 上櫃股票回填來源(櫃買 API 不同,目前自選以上市為主;失敗清單會顯示,屆時再補)。
