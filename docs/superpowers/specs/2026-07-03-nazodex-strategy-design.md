# NazoDex 選股策略推薦（多因子評分）設計

日期:2026-07-03。路線圖「選股延伸」——在條件選股(/screener)之上的策略推薦引擎。
本 spec 由授權自主執行的 session 產出,設計決策(含捨棄方案)皆記錄於此。

## 目標

條件選股回答「哪些股票符合條件」;策略推薦回答「**現在最值得看哪幾檔、為什麼**」。
做法是量化圈的截面多因子模型(cross-sectional multi-factor scoring):
把全市場每檔股票在 5 個因子上排百分位(0–100),再依策略權重加權成綜合分數,
取前 20 名附「白話推薦理由」。維持設計哲學:**使用門檻低**(點一顆策略鈕就有答案 + 看得懂的理由)、
**操作上限高**(進階者可開權重面板調自己的因子配方,即時重排)。

## 捨棄方案(記錄)

- **延伸 screener presets**:只加過濾條件沒有排名評分,無法回答「為什麼是這幾檔」。
- **歷史時序因子**(均線/RSI/波動/回測):全市場日線歷史不足(DailyQuote 2026-07 才起灌,
  backfill 只涵蓋自選∪持股),約 2026-10 後才可做,列 YAGNI。

## 資料源(全免費,已實測可用)

| 資料 | 來源 | 用途 |
|---|---|---|
| 價量/估值 | 既有 `getScreenerSnapshot()`(STOCK_DAY_ALL + BWIBBU_ALL,10min 快取) | 價值/收息/熱度因子 + 顯示 |
| 月均價 | OpenAPI `/v1/exchangeReport/STOCK_DAY_AVG_ALL`(Code/ClosingPrice/MonthlyAveragePrice) | 動能因子(月線乖離) |
| 每股三大法人買賣超 | rwd `fund/T86?selectType=ALLBUT0999&response=json`(**不帶 date → 自動回最新交易日**;單位:股) | 籌碼因子 |

皆每日盤後更新。T86 與價量源在盤中可能相差一個交易日(各自取最近可得),可接受,頁面日期以價量源為準。

## 因子定義(百分位 0–100,高者佳)

評分宇宙 universe = 通過門檻的股票:**成交 ≥ 200 張且股價 ≥ 5 元**(排除殭屍股與雞蛋水餃股對百分位的稀釋)。
百分位在 universe 內、以「該因子非 null 的股票」為母體計算:`pct = 嚴格小於該值的檔數 / (母體數−1) × 100`(母體 < 2 時取 50);「低者佳」的欄位取 `100 − pct`。

| 因子 | 輸入 | 計算 |
|---|---|---|
| 價值 value | peRatio、pbRatio | mean(PE 低者佳百分位, PB 低者佳百分位);兩者皆 null → null,僅一者有值取該值 |
| 收息 dividend | dividendYield | 高者佳百分位 |
| 動能 momentum | biasPct(月線乖離% = (close−月均)/月均×100)、changePct | mean(乖離高者佳, 當日漲幅高者佳);同 value 的 null 規則 |
| 籌碼 chips | chipsRatio(三大法人買賣超股數/成交股數×100,可為負) | 高者佳百分位 |
| 熱度 heat | volumeLots | 高者佳百分位 |

因子輸入為 null → 該因子分數 null;**非 null 因子數 < 3 的股票不進榜**(但仍在百分位母體內)。

## 策略(權重和 = 1)

| key | 名稱 | 價值 | 收息 | 動能 | 籌碼 | 熱度 | 白話 |
|---|---|---|---|---|---|---|---|
| balanced | 均衡精選 | .25 | .25 | .20 | .20 | .10 | 五力平均、體質全面 |
| income | 存股收息 | .25 | .45 | .05 | .15 | .10 | 領股息為主,兼顧不買貴 |
| value | 價值獵手 | .50 | .20 | .05 | .15 | .10 | 便宜是硬道理 |
| momentum | 動能突擊 | .05 | .05 | .45 | .25 | .20 | 順勢而為、量價齊揚 |
| chips | 主力同行 | .10 | .05 | .20 | .50 | .15 | 跟著法人腳步 |

綜合分數 = Σ(權重×因子分)/Σ(非 null 因子的權重)(**權重再正規化**:缺因子不拖分,
例如 ETF 無估值仍可憑動能/籌碼/熱度進動能榜)。同分以成交張數高者在前。取前 20 名。
另要求**策略主因子非 null**(權重最高的因子,並列取全部;prod 驗證後補的規則,2026-07-03):
存股收息榜不得出現無殖利率資料的股票——缺主因子靠再正規化「搭便車」進榜會誤導新手。

**推薦理由**:每檔取分數最高的 2 個因子,轉白話 chips,例:
「殖利率贏過 93% 的股票」「法人買超力道前 5%」「站上月均線 +4.2%」。
措辭由 `buildReasons(factorKey, score, row)` 純函式產生,只描述事實不喊買賣。

## 核心決策:因子快照下發、前端計分(沿用 screener 模式,無 DB)

- 後端 `getStrategySnapshot()`:重用 `getScreenerSnapshot()`(共享快取)+ 抓月均價、T86,
  以 symbol join 成 `FactorRow[]`(server 先算好 biasPct/chipsRatio 兩個 derived 欄位),
  memoize 10 分鐘。
- **前端拿整包因子快照**,百分位排名與加權計分在瀏覽器跑(engine 純函式前後端共用):
  切策略、拉權重滑桿即時重排、不打 API。~1,100 列與 screener 快照同量級(~40KB gzip)。

```
FactorRow = ScreenerRow + {
  biasPct: number | null,     // 月線乖離%
  chipsRatio: number | null,  // 法人買賣超佔成交量%(可負)
}
StrategySnapshot = { date: string | null; rows: FactorRow[] }
Recommendation = { row, score, factors: {value,dividend,momentum,chips,heat: number|null}, reasons: string[] }
```

## 架構

```
lib/strategy/
  types.ts     FactorRow / FactorScores / StrategyDef / StrategySnapshot / Recommendation / Weights
  dayAvg.ts    parseDayAvg + fetchDayAvg(8s abort,同 twseOpenApi 模式)
  t86.ts       parseT86 + fetchT86(rwd JSON、stat!=="OK" 視為失敗;單位股)
  engine.ts    percentile 排名、computeFactorScores(universe 門檻+null 規則)、
               recommend(rows, weights, topN) 、STRATEGIES、buildReasons —— 全純函式
  service.ts   getStrategySnapshot() — join;月均/T86/估值任一源失敗 → 對應欄 null(區塊容錯);
               價量源失敗 → throw(route 回 502)
app/api/strategy/route.ts    GET,session 驗證(同 screener route)
app/strategy/page.tsx        AppShell title「策略推薦」
components/strategy/
  StrategyView.tsx   client:載一次快照、策略 chips、權重面板開關、算分渲染
  StrategyCard.tsx   排名徽章、代號/名稱、現價/漲跌%(紅漲綠跌)、綜合分數、
                     5 因子迷你橫條(缺因子顯示「—」)、理由 chips、一鍵加自選 ✓(同 screener)
  WeightPanel.tsx    5 支滑桿(0–100,內部正規化),調整即切到「自訂配方」
components/layout/BottomNav.tsx  加第 5 tab「策略」→ /strategy
```

## UI(手機優先)

1. **策略 chips**:5 顆策略鈕 +「自訂配方」;預設「均衡精選」。chip 下一行小字顯示該策略白話說明。
2. **推薦列表**:前 20 檔 StrategyCard;點卡片進 `/stock/[symbol]`,✓ 加自選(樂觀更新,同 screener)。
3. **權重面板**(預設收合,「▸ 調整配方」):5 滑桿即時重排;點策略 chip 會重設滑桿為該策略權重。
4. 頁首標資料日期(盤中為前一交易日);頁尾免責:「依公開市場數據計算,僅供學習參考,非投資建議」。
5. 桌機沿用同一卡片流(max-w 網格兩欄),不做表格——分數/理由本質是卡片資訊。

## 錯誤處理

- STOCK_DAY_ALL 失敗 → API 502,前端「暫無資料,稍後再試」。
- BWIBBU / STOCK_DAY_AVG_ALL / T86 個別失敗 → 對應因子全 null → 權重再正規化自然吸收;
  該因子迷你條顯示「—」,理由不會提及。
- fetch 皆 8s AbortController(沿用現有模式)。

## 測試(TDD)

- `parseDayAvg`:fixture 含千分位、缺值 `-`、月均 0/缺 → null。
- `parseT86`:stat!=="OK" → throw;千分位與負數買超;股→數值;缺列容錯。
- `engine`:百分位(含 ties、母體<2)、低者佳反轉、universe 門檻、因子 null 規則(<3 不進榜)、
  權重再正規化、同分 tie-break、STRATEGIES 權重和=1、buildReasons 措辭與 top-2 選取。
- `service`:注入 fake fetcher 驗證 join 與 derived 欄位、各源失敗容錯、價量源失敗 throw。

## YAGNI(刻意不做)

- 上櫃(OTC)、歷史時序因子(均線/RSI/波動/回測,等 DailyQuote 累積,~2026-10)、
  法人「連 N 日」買超(需多日 T86)、產業中性化、儲存自訂權重、桌機頂部導覽(既有現況不順手擴)、
  雷達圖(迷你橫條已足)、伺服器端排名(前端算,權重互動零延遲)。
