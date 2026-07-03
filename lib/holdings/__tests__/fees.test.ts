import { describe, it, expect } from "vitest";
import { estimateFee, estimateTax, estimateNhi, resolveFees } from "@/lib/holdings/fees";

describe("estimateFee", () => {
  it("0.1425% 四捨五入", () => {
    // 600 * 1000 * 0.001425 = 855
    expect(estimateFee(600, 1000)).toBe(855);
  });
  it("最低 20 元", () => {
    // 10 * 100 * 0.001425 = 1.425 → 20
    expect(estimateFee(10, 100)).toBe(20);
  });
  it("小數四捨五入", () => {
    // 23.5 * 1000 * 0.001425 = 33.4875 → 33
    expect(estimateFee(23.5, 1000)).toBe(33);
  });
});

describe("estimateTax", () => {
  it("0.3% 四捨五入", () => {
    expect(estimateTax(600, 1000)).toBe(1800);
    // 23.5 * 1000 * 0.003 = 70.5 → 71
    expect(estimateTax(23.5, 1000)).toBe(71);
  });
});

describe("estimateNhi", () => {
  it("未達 2 萬不課", () => {
    expect(estimateNhi(19999)).toBe(0);
  });
  it("2 萬(含)以上課 2.11% 四捨五入", () => {
    expect(estimateNhi(20000)).toBe(422);
    // 35000 * 0.0211 = 738.5 → 739 (Math.round half-up)
    expect(estimateNhi(35000)).toBe(739);
  });
});

describe("resolveFees", () => {
  it("BUY:缺省補估算手續費,稅 0", () => {
    expect(resolveFees("BUY", 1000, 600)).toEqual({ fee: 855, tax: 0 });
  });
  it("SELL:缺省補手續費+證交稅", () => {
    expect(resolveFees("SELL", 1000, 600)).toEqual({ fee: 855, tax: 1800 });
  });
  it("使用者覆寫優先", () => {
    expect(resolveFees("BUY", 1000, 600, 20, 5)).toEqual({ fee: 20, tax: 5 });
  });
  it("DIV_CASH:預設匯費 10、達門檻補充費", () => {
    // 10000 股 * 2.5 元 = 25000 ≥ 20000 → nhi = round(25000*0.0211) = 528
    expect(resolveFees("DIV_CASH", 10000, 2.5)).toEqual({ fee: 10, tax: 528 });
    // 1000 股 * 2.5 = 2500 < 20000 → 0
    expect(resolveFees("DIV_CASH", 1000, 2.5)).toEqual({ fee: 10, tax: 0 });
  });
  it("DIV_STOCK:一律歸零(覆寫也無效)", () => {
    expect(resolveFees("DIV_STOCK", 1000, 0, 99, 99)).toEqual({ fee: 0, tax: 0 });
  });
});
