// 素材像素轉換純函式(與 sharp I/O 分離,可單元測試)。
// lumaToAlpha:深色底發光線條圖 → 透明底。alpha 取 max(r,g,b) 再減 floor 重縮放
// (AI 生成圖的深色底非純黑、帶噪點,floor 以下視為背景砍成全透明,否則殘留暗紗且檔案暴肥),
// 色彩反預乘(除以原亮度)讓合成回深色底時視覺等同原圖(近似 additive)。
export function lumaToAlpha(data, floor = 28) {
  const scale = 255 / (255 - floor);
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.max(data[i], data[i + 1], data[i + 2]);
    const a = luma <= floor ? 0 : Math.round((luma - floor) * scale);
    if (a === 0) {
      data[i] = data[i + 1] = data[i + 2] = 0;
    } else {
      data[i] = Math.min(255, Math.round((data[i] * 255) / luma));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / luma));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / luma));
    }
    data[i + 3] = a;
  }
}

// edgeFade:距任一邊 < margin px 的像素,alpha 依距離線性淡出到 0。
export function edgeFade(data, width, height, margin) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (d >= margin) continue;
      const i = (y * width + x) * 4 + 3;
      data[i] = Math.round((data[i] * d) / margin);
    }
  }
}
