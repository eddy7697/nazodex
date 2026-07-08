# NazoDex 大盤與產業總覽 設計

日期:2026-07-03。路線圖第 1 項「大盤與產業總覽」。

## 目標

給投資新手一頁看懂「今天市場長什麼樣」:大盤漲跌、多空家數、法人動向、哪些產業強弱。
維持設計哲學:乾淨、漸進揭露,不堆專業術語。

## 資料源(全免費、無需 token —— 實測可用,不需 FinMind)

| 區塊 | 來源 | 更新頻率 |
|---|---|---|
| 指數(加權/櫃買) | MIS `ex_ch=tse_t00.tw\|otc_o00.tw`(重用現有 `misSource`) | 盤中即時,30s 快取 |
| 漲跌家數 | TWSE rwd `afterTrading/MI_INDEX?response=json` →「漲跌證券數合計」表 | 每日盤後(盤中顯示前一交易日,標日期) |
| 三大法人買賣超 | TWSE rwd `fund/BFI82U?response=json` | 每日盤後(同上) |
| 強弱產業 | TWSE OpenAPI `/v1/exchangeReport/MI_INDEX` 過濾「⋯類指數」(排除報酬指數) | 每日盤後(同上) |

註:漲跌家數取「股票」欄(上市股票,格式 `649(54)` = 家數(漲跌停));三大法人彙總為
外資(含外資自營商)/投信/自營商(自行+避險)/合計;rwd 日期為 `20260702`、OpenAPI 為民國 `1150702`,parser 各自正規化為 ISO。

## 架構(沿用 quote-service 抽象層模式)

```
lib/market-overview/
  types.ts     MarketOverview / Breadth / InstitutionalFlow / SectorChange
  indices.ts   getIndexQuotes() — 重用 fetchIntradayQuotes,t00/o00 → 加權指數/櫃買指數
  twseRwd.ts   parseBreadth / parseInstitutional 純函式 + fetch(8s abort,同 twseOpenApi 模式)
  sectors.ts   parseSectorIndices 純函式 + fetch
  service.ts   getMarketOverview() — memoize(指數 30s、每日資料 10min),區塊獨立容錯(失敗回 null)
app/api/market/route.ts   GET,session 驗證(同 watchlist route)
app/market/page.tsx + components/market/
  MarketView.tsx(client,60s 輪詢)
  IndexCard / BreadthBar / InstitutionalCard / SectorList
```

## UI(手機優先,同現有卡片風格)

1. **指數列**:加權指數、櫃買指數兩張卡 —— 大字現價、漲跌與 %(紅漲綠跌,用 `changeColorClass`/`fmtPrice`/`fmtSignedPct`)。
2. **漲跌家數**:紅綠比例橫條 + 上漲/下跌/平盤家數(含漲跌停數,小字)。
3. **三大法人**:外資/投信/自營商三列,買賣超以「億」顯示,正紅負綠;合計置底。
4. **強弱產業**:最強 5 / 最弱 5 兩欄,類股名 + 漲跌 %。
5. 每日區塊標示資料日期(盤中為前一交易日,誠實標示即可,不做盤中估算)。

## 錯誤處理

- 任一上游失敗 → 該區塊為 null,UI 顯示「暫無資料」,不影響其他區塊。
- fetch 均 8s AbortController(沿用現有模式)。

## 測試(TDD)

- parser 純函式:實際回應 fixture(含 `-` 缺值、逗號千分位、民國日期、`649(54)` 格式)。
- service:注入 fake fetcher,驗證組裝與單區塊失敗容錯。
- BreadthBar 元件 render 測試(同 QuoteCard 模式)。

## YAGNI(刻意不做)

- 盤中即時漲跌家數/法人(免費源無)、大盤 K 線、三大法人歷史圖、產業→個股下鑽、上櫃漲跌家數與法人、成交金額統計。
- 不新增 DB 表、不動 ingest cron —— 全部即時拉 + 記憶體快取。
