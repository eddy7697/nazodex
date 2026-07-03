import { describe, it, expect } from "vitest";
import { estimateFee, estimateTax } from "@/lib/holdings/fees";

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
