# NazoDex 設計語言 ——「金脈 Golden Ridge」+ 圖片素材生成提示詞

日期:2026-07-05
狀態:訪談定案
生圖工具:ChatGPT / DALL-E(長段自然語言提示詞)

## 一、設計語言總綱

### 核心比喻:山脈稜線 = 行情走勢

上升的稜線既是 K 線走勢,也是台灣的山。所有素材共用這個意象:

- **Logo**:上升趨勢線 × 山峰稜線的抽象圖形
- **空狀態插圖**:發光金色線條插畫,場景圍繞山稜/地形展開
- **背景紋理**:等高線地形紋(山的等高線 = 市場的地形)

### 色彩系統

| 角色 | 色值 | 用途 |
|------|------|------|
| 背景 | `#0b0f14` | 頁面底色(既有) |
| 卡片 | `#131a22` | 卡片底色(既有) |
| 品牌金(深) | `#f59e0b` | 漸層起點、主要線條 |
| 品牌金(亮) | `#fbbf24` | 漸層終點、光暈高光 |
| 紅漲 | `#d92d20` | **語意色,素材中禁用** |
| 綠跌 | `#12b76a` | **語意色,素材中禁用** |

素材中一律避開紅、綠——把它們留給行情數字。

### 性格

現代金融科技:深色、微光、克制的漸層。像夜裡發光的金色線,不是霓虹賭場。
關鍵詞:premium、calm、confident、glowing line art。

## 二、共用風格鎖定句(Style Lock)

每一則提示詞開頭都用同一段風格描述,確保多張圖風格一致。
在 ChatGPT 同一個對話串中連續生成,一致性更好。

> Minimalist fintech illustration in glowing golden line art. Thin, elegant lines in an amber-gold gradient (#f59e0b to #fbbf24) with a subtle warm glow, like fine neon wire in the dark, on a very dark navy background (#0b0f14). Generous negative space, calm and premium mood. Strictly no red, no green, no text, no letters, no numbers.

以下每則提示詞已把這段揉進去,可直接整段貼上。

## 三、提示詞

### 1. Logo 主圖形(Logo Mark)

用途:頁首品牌、登入頁。建議尺寸 1024×1024,生成後以向量描圖(如 potrace / Illustrator Image Trace)轉 SVG。

> A minimalist abstract logo mark for a premium stock-market dashboard app. The mark is a single continuous rising line that reads simultaneously as a stock-price trend line and a mountain ridge silhouette: two or three angular peaks, each higher than the last, the final peak clearly the highest, suggesting upward momentum. Clean flat vector style, the line rendered in an amber-gold gradient from #f59e0b to #fbbf24 with a very subtle warm glow, on a solid very dark navy background (#0b0f14). Geometric, confident, modern fintech aesthetic. The mark is perfectly centered with generous empty space around it. Flat 2D vector, no 3D, no shadows, no text, no letters, no red, no green.

字標(wordmark)「NazoDex」**不建議用生圖工具生成**——文字交給字體處理最乾淨。建議搭配幾何無襯線字體(如 Inter、Space Grotesk、Manrope 的 SemiBold),金色或近白 `#e6edf3` 排在圖形右側。

若仍想看含字標的合成效果,可加一句:

> Next to the mark, add the wordmark "NazoDex" in a clean geometric sans-serif font, colored soft white (#e6edf3). Keep the spelling exactly "NazoDex".

### 2. App Icon / Favicon

用途:LIFF、PWA、瀏覽器分頁。1024×1024,線條要比 Logo 粗,縮小到 16px 仍可辨識。

> A mobile app icon, 1024x1024. A rounded-square tile filled with very dark navy (#0b0f14) with an extremely subtle radial glow in the center. On the tile, a bold simplified mountain-ridge trend line: one continuous thick stroke forming two angular peaks, the second peak higher, rendered in an amber-gold gradient from #f59e0b to #fbbf24 with a soft warm glow. The stroke is thick and confident so it stays legible at very small sizes. Flat modern fintech style, perfectly centered, no text, no letters, no red, no green, no border.

### 3. 空狀態插圖(共 4 張)

用途:嵌在卡片/頁面中央,建議 1024×1024 生成後裁切使用。四張共用風格鎖定句,只換主體場景,構圖都要求「主體置中、四周大量留白、下方預留文案空間」。

#### 3a. 自選股空清單(還沒加入任何股票)

> Minimalist fintech illustration in glowing golden line art. Thin, elegant lines in an amber-gold gradient (#f59e0b to #fbbf24) with a subtle warm glow, like fine neon wire in the dark, on a very dark navy background (#0b0f14). The scene: a small outlined five-pointed star hovering above a gentle mountain-ridge trend line, with a short dotted line path connecting the star down toward the ridge, as if the star is about to be placed onto the chart. A few tiny sparkle dots around the star. Centered composition with generous negative space, extra empty space at the bottom for a caption. Calm and premium mood. Strictly no red, no green, no text, no letters, no numbers.

情境語意:星星 = 收藏/自選,即將落在走勢線上 =「把股票加進來」。

#### 3b. 無持股(還沒有任何交易紀錄)

> Minimalist fintech illustration in glowing golden line art. Thin, elegant lines in an amber-gold gradient (#f59e0b to #fbbf24) with a subtle warm glow, like fine neon wire in the dark, on a very dark navy background (#0b0f14). The scene: an open, empty outlined wallet or pouch drawn in thin golden lines, with one single outlined coin floating just above the opening, and a faint small mountain-ridge line on the coin face. A few tiny sparkle dots. Centered composition with generous negative space, extra empty space at the bottom for a caption. Calm and premium mood, inviting rather than sad. Strictly no red, no green, no text, no letters, no numbers.

情境語意:空錢包 + 一枚待落下的金幣 =「記下第一筆交易」。

#### 3c. 選股無結果(條件太嚴,沒有符合的股票)

> Minimalist fintech illustration in glowing golden line art. Thin, elegant lines in an amber-gold gradient (#f59e0b to #fbbf24) with a subtle warm glow, like fine neon wire in the dark, on a very dark navy background (#0b0f14). The scene: a large outlined magnifying glass held over a faint topographic contour-line map, the area inside the lens completely empty and dark, with two or three tiny sparkle dots drifting near the lens. Centered composition with generous negative space, extra empty space at the bottom for a caption. Calm and premium mood. Strictly no red, no green, no text, no letters, no numbers.

情境語意:放大鏡下的等高線地圖裡什麼都沒有 =「放寬條件再找找」。

#### 3d. 盤後/休市(市場休息中)

> Minimalist fintech illustration in glowing golden line art. Thin, elegant lines in an amber-gold gradient (#f59e0b to #fbbf24) with a subtle warm glow, like fine neon wire in the dark, on a very dark navy background (#0b0f14). The scene: a thin crescent moon hanging above a long, calm mountain-ridge horizon line, with two or three small four-pointed stars in the sky. The ridge line is gentle and settled, as if the market is resting for the night. Centered composition with generous negative space, extra empty space at the bottom for a caption. Serene, quiet, premium mood. Strictly no red, no green, no text, no letters, no numbers.

情境語意:月亮 + 沉靜的稜線 =「市場休息中,明天再戰」。

### 4. 背景/裝飾紋理

#### 4a. 等高線地形紋(頁面背景)

用途:頁面背景平鋪或大面積鋪底。DALL-E 無法保證真正無縫,生成後建議取中央區域裁切,或用後製工具(如 Photoshop offset)修接縫;CSS 端也可以 `opacity` 再壓一層保險。

> A seamless repeating background pattern of topographic contour lines, like an elevation map of mountain terrain. Extremely thin amber-gold lines (#f59e0b) at very low opacity — barely visible, around 6 to 8 percent brightness — on a very dark navy background (#0b0f14). The contour lines form organic nested loops and ridges with uniform density across the whole image, no focal point, no markers, no labels. Flat, subtle, elegant, designed to sit quietly behind a data dashboard without distracting from numbers. Strictly no red, no green, no text, no letters, no numbers.

#### 4b. 卡片 Header 裝飾條(橫幅)

用途:市場總覽、策略推薦等區塊的 header 裝飾。建議 1792×1024 生成後橫向裁切;右側漸暗留給標題文字。

> A wide decorative banner on a very dark navy background (#0b0f14). Flowing mountain-ridge contour lines sweep from the left edge toward the center, drawn as thin amber-gold lines (#f59e0b to #fbbf24) with a subtle warm glow, the lines gradually fading out and dissolving into darkness on the right half of the image, leaving the right side almost completely dark and empty for text overlay. Elegant, calm, premium fintech mood. Strictly no red, no green, no text, no letters, no numbers.

## 四、生成技巧

1. **同一對話串連續生成**:在 ChatGPT 同一串對話裡依序生成全部素材,並先貼上風格鎖定句說「接下來所有圖都用這個風格」,一致性最好。
2. **每張生 2–4 個變體**再挑:線條插畫風格對細節敏感,多抽幾張。
3. **修圖用增量指令**:不滿意時不要重寫整段,對著結果說「線條再細一點」「光暈再收斂」「留白再多」。
4. **Logo 務必轉向量**:挑定後用 Illustrator Image Trace 或 potrace 描成 SVG,才能在任意尺寸與底色上使用;順便做一版單色(純 `#f59e0b`)供小尺寸/單色場景。
5. **透明背景**:DALL-E 產出的深色底可用去背工具處理,但線條光暈去背易破——插圖建議直接連深色底使用(底色與 `--bg`/`--card` 同色即可無縫)。
6. **落地時的對應**:素材導入後,`--brand: #f59e0b` / `--brand-bright: #fbbf24` 應進 `globals.css` 成為正式 design token,按鈕/重點/圖表高亮改用品牌金,與素材呼應。

## 五、素材規格總表

| # | 素材 | 生成尺寸 | 用途 | 後製 |
|---|------|----------|------|------|
| 1 | Logo 主圖形 | 1024×1024 | 頁首、登入頁 | 向量描圖轉 SVG + 單色版 |
| 2 | App icon | 1024×1024 | LIFF/PWA/favicon | 縮圖測 16/32/180px |
| 3a | 空狀態:自選股 | 1024×1024 | 自選股空清單 | 裁切、壓 WebP |
| 3b | 空狀態:持股 | 1024×1024 | 無持股紀錄 | 裁切、壓 WebP |
| 3c | 空狀態:選股 | 1024×1024 | 篩選無結果 | 裁切、壓 WebP |
| 3d | 空狀態:休市 | 1024×1024 | 盤後/休市提示 | 裁切、壓 WebP |
| 4a | 等高線背景紋 | 1024×1024 | 頁面背景 | 修接縫、降不透明度 |
| 4b | Header 裝飾條 | 1792×1024 | 區塊 header | 橫向裁切 |
