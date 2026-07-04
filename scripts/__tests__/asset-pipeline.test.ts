import { describe, it, expect } from "vitest";
import { lumaToAlpha, edgeFade } from "../asset-pipeline.lib.mjs";

describe("lumaToAlpha", () => {
  it("純黑變全透明", () => {
    const px = new Uint8Array([0, 0, 0, 255]);
    lumaToAlpha(px);
    expect(px[3]).toBe(0);
  });
  it("深色底噪點(低於 floor)整個變全透明", () => {
    // AI 生成圖的深藍底 (11,15,20) 不是純黑,必須被 floor 砍掉
    const px = new Uint8Array([11, 15, 20, 255]);
    lumaToAlpha(px, 28);
    expect(px[3]).toBe(0);
  });
  it("亮金色線條保持不透明且色彩反預乘,alpha 依 floor 重縮放", () => {
    // 半亮金 (200,150,20) → max=200,alpha=(200-28)*255/(255-28)≈193,RGB 依 255/200 放大
    const px = new Uint8Array([200, 150, 20, 255]);
    lumaToAlpha(px, 28);
    expect(px[3]).toBe(Math.round(((200 - 28) * 255) / (255 - 28))); // 193
    expect(px[0]).toBe(255); // 200*255/200
    expect(px[1]).toBe(Math.round((150 * 255) / 200)); // 191
    expect(px[2]).toBe(Math.round((20 * 255) / 200)); // 26
  });
  it("反預乘不超過 255", () => {
    const px = new Uint8Array([255, 255, 255, 255]);
    lumaToAlpha(px);
    expect([...px]).toEqual([255, 255, 255, 255]);
  });
});

describe("edgeFade", () => {
  it("邊緣像素 alpha 歸零、中心不變", () => {
    // 5x5 全白全不透明,margin=2
    const w = 5, h = 5;
    const data = new Uint8Array(w * h * 4).fill(255);
    edgeFade(data, w, h, 2);
    const alphaAt = (x: number, y: number) => data[(y * w + x) * 4 + 3];
    expect(alphaAt(0, 2)).toBe(0); // 貼邊 → 0
    expect(alphaAt(1, 2)).toBe(128); // 距邊 1/margin 2 → 一半
    expect(alphaAt(2, 2)).toBe(255); // 中心 → 不變
  });
});
