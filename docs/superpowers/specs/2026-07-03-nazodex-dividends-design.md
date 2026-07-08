# NazoDex 持股股利／除權息 — 設計文件

日期：2026-07-03
狀態：已核准（Vincent 授權自主決策，延續持股損益 spec 的授權模式）

## 目標

持股損益 v1 刻意不做的「股利／除權息」補上：使用者手動記一筆現金股利或配股，部位與損益自動反映——現金股利累計為「股利收入」，配股增加股數、稀釋平均成本。延續「使用門檻低、操作上限高」：記現金股利只需 每股股利（股數預填目前持股），進階者可改匯費／健保補充費。

## 核心決策

1. **沿用交易流水帳為唯一事實來源**：不開新表、不動 schema（`side` 為 String，`quantity`/`price`/`fee`/`tax` 欄位語意可重用）。新增兩種交易型別：
   - `DIV_CASH` 現金股利：`quantity`=參與除息股數、`price`=每股股利(元)、`fee`=匯費(元)、`tax`=二代健保補充保費(元)。實收現金 = `quantity*price - fee - tax`。不影響股數與成本。
   - `DIV_STOCK` 股票股利（配股）：`quantity`=配得股數、`price`/`fee`/`tax` 皆 0。`shares += quantity`，`totalCost` 不變 → 平均成本自然稀釋（除權後成本攤薄，與券商 App 一致）。
2. **股利收入與已實現損益分開列**：`Position` 新增 `dividendIncome`（該檔累計實收現金股利），`Summary` 新增 `dividendIncome` 加總。不混入 `realizedPnl`——新手能分清「賣出賺的」和「領到的股利」；報酬率計算維持未實現/成本，不做含息報酬率（YAGNI）。
3. **費用自動估算，可覆寫**（同 v1 模式）：匯費預設 10 元；健保補充保費在單筆股利金額 ≥ 20,000 元時預估 `round(金額 × 0.0211)`，否則 0。表單預填，可改，存入 DB 的是最終數字。
4. **超賣驗證納入配股**：重放時 `DIV_STOCK` 視為 +quantity（刪配股單可能讓其後賣單超賣，重放自動擋下）；`DIV_CASH` 不影響股數。股利交易不做「當時必須有持股」檢查——除息日持有、發放日已出清是合法情境，過度防呆反而擋正常紀錄。
5. **已出清但有股利者照列總覽加總**：與 realizedPnl 同規則（shares=0 仍輸出，前端只列 shares>0）。

## 資料模型

無 migration。`side` 值域擴為 `"BUY" | "SELL" | "DIV_CASH" | "DIV_STOCK"`。

## 模組變更

### `lib/holdings/fees.ts`
- `estimateNhi(amount: number): number` — 單筆股利 ≥ 20,000 元課 2.11% 四捨五入，否則 0。（匯費預設 10 為前端表單常數，不需函式。）

### `lib/holdings/positions.ts`
- `Side` 型別擴充；`Txn` 不變。
- `computePositions`：`DIV_CASH` → `dividendIncome += qty*price - fee - tax`；`DIV_STOCK` → `shares += qty`（成本不變）。`Position` 加 `dividendIncome`。
- `validateNoOversell`：`DIV_STOCK` 計 +qty；`DIV_CASH` 略過。
- `computeSummary`：`Summary` 加 `dividendIncome`（全部位加總，含已出清）。

### `lib/holdings/service.ts`
- `NewTxnInput.side` 型別隨 `Side` 擴充，其餘不動（重放驗證已涵蓋新型別）。

## API

- `POST /api/holdings/transactions`：side 白名單擴為四值；`DIV_CASH` 缺 fee 補 10、缺 tax 以 `estimateNhi` 補；`DIV_STOCK` 強制 price/fee/tax = 0、price 允許 0（原「price > 0」驗證改為僅 BUY/SELL/DIV_CASH 要求 > 0）。
- `GET /api/holdings` 回傳自然帶出 `dividendIncome`（positions/summary 型別擴充）。
- 其餘端點不變（刪除已由重放驗證涵蓋）。

## 前端 `/holdings`

- **AddTransaction**：買/賣切換改為四型別（買進｜賣出｜現金股利｜配股）。
  - 現金股利：股數預填目前持股（由父層傳入該檔 shares，搜尋選股後帶入）、每股股利、匯費（預填 10）、健保補充費（依金額自動重估，可改）、日期。
  - 配股：僅 股數＋日期。
- **TransactionList**：股利列標示「現金股利」（顯示每股股利與實收金額）／「配股」（顯示股數）；可刪（沿用既有 confirm + DELETE）。
- **PositionCard / PositionRow**：展開區顯示「累計股利」（>0 才顯示）。
- **SummaryBar**：新增「股利收入」（>0 才顯示，色用 `changeColorClass` 正值紅）。
- 金額顯示沿用 `fmtMoney`／`fmtSignedMoney`。

## 錯誤處理

- 刪配股單導致超賣：既有 `OversellError` → 400「持股不足」路徑自動涵蓋。
- `DIV_STOCK` 帶非零 price/fee/tax：server 端直接歸零（不報錯，防呆優先）。
- 其餘沿用 v1（401、400 驗證訊息）。

## 測試（TDD，Vitest）

- `fees.test.ts`：`estimateNhi` 門檻（19,999→0、20,000→422）、四捨五入。
- `positions.test.ts`：現金股利累計（含扣匯費/補充費）、配股稀釋均價（成本不變股數增）、配股後賣出的已實現計算、刪配股導致超賣、已出清仍列股利、summary 股利加總。
- `service.test.ts`：新增 DIV 型別交易、DIV_STOCK 欄位歸零、跨使用者隔離不變。
- API route 驗證：side 白名單、DIV_CASH 預設費用補值。

## 不做（YAGNI）

自動抓除權息資料預填（TWSE 有源，等有痛點再做）、含息報酬率、股利再投入自動化、除權息還原價（K 線）、現金帳。
