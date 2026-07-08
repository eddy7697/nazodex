# NazoDex 條件選股 設計

日期:2026-07-03。路線圖第 1 項「條件選股」。

## 目標

給投資新手一鍵找股票:內建幾個「聽得懂的」選股策略(定存股、便宜好股、今日強勢),
一鍵套用看結果;想調整的人再展開條件面板微調數值。
維持設計哲學:使用門檻低(preset 一鍵)、操作上限高(條件可自訂)。

## 資料源(全免費 TWSE OpenAPI,實測可用,無需 token / FinMind)

| 資料 | 來源 | 欄位 |
|---|---|---|
| 價量(收盤/漲跌/成交量) | `/v1/exchangeReport/STOCK_DAY_ALL` | Date(民國)/Code/Name/ClosingPrice/Change(帶正負)/TradeVolume(股) |
| 估值(本益比/殖利率/淨值比) | `/v1/exchangeReport/BWIBBU_ALL` | Date/Code/PEratio/DividendYield/PBratio(缺值為空字串,如虧損股無本益比) |

兩者皆每日盤後更新(盤中看到的是前一交易日),以 Code 在記憶體 join。
上市(TSE)股票約 1,000+ 檔;ETF 會出現在價量表但無估值 → 估值欄為 null。

## 核心決策:快照下發、前端過濾(無 DB、無 migration)

- 後端 `getScreenerSnapshot()`:拉兩個 OpenAPI → join → 產出 `ScreenerRow[]`(約 1,100 列、~30KB gzip),記憶體快取 10 分鐘(同 market-overview 模式)。
- **前端拿整包快照後在瀏覽器過濾**:調整條件即時反應、不打 API。每日資料本來就一天一變,快照下發最簡單也最順。
- 不新增 DB 表、不動 ingest cron。DB 的 DailyQuote 歷史尚淺(剛開始灌),做不了均線類技術指標 —— 列入 YAGNI。

```
ScreenerRow = {
  symbol, name,
  close, changePct,        // changePct 由 Change/(Close-Change) 推得;前收 ≤ 0 或缺 Change 時為 null
  volumeLots,              // 成交張數 = TradeVolume/1000,取整
  peRatio, dividendYield, pbRatio,   // number | null(空字串→null)
}
```

## 條件模型與內建策略

```
Condition = { field: NumericField; op: "gte" | "lte"; value: number }
```

- 條件為 AND 串接;**欄位為 null 的列不符合該條件**(明確排除,避免虧損股混入低本益比結果)。
- 內建 preset(一鍵套用後仍可再微調):

| Preset | 條件 | 白話 |
|---|---|---|
| 高殖利率 | 殖利率 ≥ 5%、本益比 ≤ 20、成交 ≥ 500 張 | 領股息的定存股,排除冷門與貴股 |
| 便宜好股 | 本益比 ≤ 12、淨值比 ≤ 1.5、殖利率 ≥ 3% | 估值便宜還有配息 |
| 今日強勢 | 漲幅 ≥ 3%、成交 ≥ 1,000 張 | 今天有量又漲的熱門股 |

## 架構

```
lib/screener/
  types.ts     ScreenerRow / Condition / Preset / ScreenerSnapshot
  bwibbu.ts    parseBwibbu 純函式 + fetchBwibbu(8s abort,同 twseOpenApi 模式)
  engine.ts    applyConditions(rows, conditions) 純函式 + PRESETS + sortRows
  service.ts   getScreenerSnapshot() — join 價量與估值,memoize 10min;
               估值源失敗 → 估值欄全 null 仍可篩價量(區塊容錯);價量源失敗 → throw(route 回 502)
lib/ingest/twseOpenApi.ts   DailyRow 增加 change(number|null)與 date(ISO|null)欄位(ingest 不受影響)
app/api/screener/route.ts   GET,session 驗證(同 market route)
app/screener/page.tsx + components/screener/
  ScreenerView.tsx(client:載入快照一次,前端過濾+排序)
  PresetChips / ConditionPanel / ResultList(手機卡片、桌機表格,同 watchlist 響應式模式)
```

## UI(手機優先)

1. **Preset chips**:三顆策略鈕 + 「自訂」;點選即套用並顯示結果。
2. **條件面板**(預設收合):每條件一列 —— 開關 + 欄位名 + 方向(≥/≤)固定 + 數值輸入;調整即時重算。
3. **結果列表**:符合檔數置頂;每列顯示 代號/名稱、現價、漲跌%(紅漲綠跌 `changeColorClass`)、殖利率、本益比、成交張數;點列進 `/stock/[symbol]`。
4. 排序:各 preset 定義預設排序(高殖利率→殖利率高至低、便宜好股→本益比低至高、今日強勢與自訂→漲跌%高至低);桌機點欄位表頭切換,手機用排序選單;null 值一律排最後。
5. 結果上限顯示 100 檔(顯示「僅列前 100」),避免長列表;資料日期標示於頁首(盤中為前一交易日)。

## 錯誤處理

- BWIBBU 失敗 → 估值欄 null,估值類條件自然全排除,UI 於估值欄顯示「—」。
- STOCK_DAY_ALL 失敗 → API 502,前端顯示「暫無資料,稍後再試」。
- fetch 8s AbortController(沿用現有模式)。

## 測試(TDD)

- `parseBwibbu`:fixture 含空字串缺值、逗號千分位。
- twseOpenApi:change/date 新欄位(含負值、`-` 缺值)。
- `engine`:gte/lte、AND 串接、null 排除、排序(null 排最後)、PRESETS 形狀。
- `service`:注入 fake fetcher 驗證 join、估值源失敗容錯、價量源失敗 throw。

## YAGNI(刻意不做)

- 上櫃(OTC)股票、技術指標(均線/RSI —— DB 歷史尚淺)、產業別篩選(Stock.industry 未回填)、
  儲存自訂策略、選股結果一鍵加自選、FinMind 基本面(ROE/EPS 成長)、回測、伺服器端分頁。
