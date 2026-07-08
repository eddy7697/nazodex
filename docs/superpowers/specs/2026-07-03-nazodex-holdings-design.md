# NazoDex 持股損益追蹤 — 設計文件

日期：2026-07-03
狀態：已核准（Vincent 授權自主決策）

## 目標

給投資新手（Vincent 與太太）記錄實際買賣，隨時看到：每檔持股的平均成本、現價、市值、未實現損益與報酬率；帳戶層級的總市值、總成本、總未實現損益、總報酬率、已實現損益。延續「使用門檻低、操作上限高」：輸入一筆買進只需 股票+股數+價格，費用自動估算；進階者可改費用、記賣出、看交易明細。

## 核心決策

1. **交易流水帳是唯一事實來源**。只存 `HoldingTransaction`（每筆買/賣），部位（持股數、平均成本、已實現損益）全部由純函式即時推導，不存衍生欄位——不會有「部位表和交易帳不一致」的 bug，改成本邏輯不用跑資料修復。
2. **平均成本法**（台股散戶與券商 App 慣用，非 FIFO）：
   - 買進：`totalShares += qty`，`totalCost += qty*price + fee`
   - 賣出：`realized += (qty*price - fee - tax) - avgCost*qty`，`totalShares -= qty`，`totalCost -= avgCost*qty`（avgCost = totalCost/totalShares，賣出前計算）
   - 交易依 `date` 升冪、同日依 `createdAt` 升冪處理。
3. **台股費用自動估算，可覆寫**：手續費 `max(20, round(成交金額 × 0.001425))`；賣出加證交稅 `round(成交金額 × 0.003)`。表單預填估算值，使用者可改（券商折扣各異）。存入 DB 的是最終數字。
4. **未實現損益不預扣賣出成本**：`unrealized = price*shares - totalCost`，`returnPct = unrealized/totalCost`。與多數看盤 App 一致，對新手直觀。
5. **賣出防呆**：新增/刪除交易時重放該檔全部交易，任一時點持股 < 0 即拒絕（400「持股不足」）。防手滑記錯方向。
6. **數量單位為股**：DB 與 API 都用股。表單提供「張」快速鍵（×1000），顯示時 ≥1000 股併標示張數。

## 資料模型（Prisma migration 0003）

```prisma
model HoldingTransaction {
  id          String   @id @default(cuid())
  userId      String
  stockSymbol String
  side        String   // "BUY" | "SELL"
  quantity    Int      // 股數
  price       Float    // 每股成交價
  fee         Int      @default(0) // 手續費(元)
  tax         Int      @default(0) // 證交稅(元,賣出才有)
  date        DateTime @db.Date    // 成交日
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, stockSymbol])
}
```

`User` 加 `transactions HoldingTransaction[]`。`price` 用 Float 與 `DailyQuote` 一致；金額（fee/tax/損益）以元為整數計。

## 模組

### `lib/holdings/fees.ts`（純函式）
- `estimateFee(price, qty): number` — 0.1425%，最低 20。
- `estimateTax(price, qty): number` — 0.3%（賣出用）。

### `lib/holdings/positions.ts`（純函式，本功能的核心）
- `computePositions(txns: Txn[]): Position[]` — 依上面平均成本法重放，輸出每檔 `{ symbol, shares, totalCost, avgCost, realizedPnl }`。已全數出清（shares=0）但有已實現損益者仍輸出（供總覽已實現加總），前端只列 shares>0 的部位。
- `validateNoOversell(txns: Txn[]): { ok: true } | { ok: false; symbol: string }` — 時序重放，任一時點任一檔持股 < 0 即 fail。
- `computeSummary(positions, quotesBySymbol): Summary` — `{ marketValue, totalCost, unrealizedPnl, returnPct, realizedPnl }`；缺報價的部位（如下市）不計入市值與未實現，前端標示「無報價」。

### `lib/holdings/service.ts`（Prisma，依 watchlist/service.ts 模式注入 `p: P = defaultPrisma`）
- `listTransactions(userId, symbol?)` — date desc, createdAt desc。
- `addTransaction(userId, input)` — 先取該檔既有交易 + 新交易做 `validateNoOversell`，通過才寫入。
- `deleteTransaction(userId, id)` — **以 userId+id 過濾**；刪除 BUY 前同樣重放驗證（刪掉買單可能讓後面的賣單超賣）。
- `getPositions(userId)` — listTransactions → computePositions。

**每個查詢都以 session userId 過濾**（與 watchlist 同一鐵律）。

## API（皆 `auth()` 驗證，401 未登入）

- `GET /api/holdings` → `{ positions: [{...position, quote}], summary }`。報價走 `getQuotes()`（quote-service 抽象層，自帶盤中/盤後與快取）。
- `GET /api/holdings/transactions?symbol=2330` → `{ transactions }`（symbol 可省略 = 全部）。
- `POST /api/holdings/transactions` body `{ symbol, side, quantity, price, fee?, tax?, date }`；fee/tax 缺省時 server 端以估算式補；驗證：side ∈ {BUY,SELL}、quantity 正整數、price > 0、date 合法；超賣回 400 `{ error: "持股不足" }`。
- `DELETE /api/holdings/transactions/[id]` → 404 若不存在或非本人；刪後導致超賣回 400。

## 前端 `/holdings`

`app/holdings/page.tsx` = `<AppShell title="持股損益"><HoldingsView /></AppShell>`（middleware 已保護非公開路徑）。

`components/holdings/`：
- **HoldingsView**（client）：fetch `/api/holdings`，60s 輪詢（同 WatchlistView 模式）。空狀態引導文案。
- **SummaryBar**：總市值、未實現損益（額+%）、總成本、已實現損益。損益色用 `changeColorClass`。
- **PositionCard**（手機）/ **PositionRow**（電腦表格）：名稱代號、股數（≥1000 併示張）、平均成本、現價、市值、未實現損益額+報酬率。點擊展開 **TransactionList**（該檔交易明細，每筆可刪，confirm 後 DELETE）。名稱連到 `/stock/[symbol]`。
- **AddTransaction**：折疊式表單（按「＋ 記一筆」展開）。股票搜尋沿用 `/api/stocks/search`；買/賣切換；股數（含「1 張」快速鍵）、價格、日期（預設今日）、費用欄位自動預填估算值可改。送出後刷新，錯誤訊息顯示於表單。

紅漲綠跌、`fmtPrice`/`fmtSignedPct` 沿用；`lib/format.ts` 新增 `fmtMoney(n)`（整數四捨五入千分位，帶正負號版 `fmtSignedMoney`）。

## 錯誤處理

- 超賣：service 擲 `OversellError` → API 400 中文訊息 → 表單顯示。
- 報價缺失：部位照列、市值/損益欄顯示「—」並標「無報價」，不阻塞其他部位。
- 未登入 API 401（middleware 已擋頁面）。

## 測試（TDD，Vitest）

- `fees.test.ts`：費率、最低 20 元、四捨五入。
- `positions.test.ts`（重點）：單筆買進、多筆攤平、賣出後已實現與剩餘成本、全數出清、超賣驗證（含刪買單情境）、同日排序、summary 加總與缺報價處理。
- `service.test.ts`：mock prisma（仿 watchlist 測試），CRUD、跨使用者隔離、超賣拒絕、刪他人交易無效。
- `format.test.ts` 增補 `fmtMoney`。

## 不做（YAGNI）

股利/除權息、現金帳與入金、多幣別、券商匯入、FIFO 切換、編輯交易（先刪再加即可）、報表圖表。
