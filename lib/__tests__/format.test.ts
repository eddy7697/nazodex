import { describe, it, expect } from "vitest";
import { changeColorClass, fmtPrice, fmtSignedPct, fmtMoney, fmtSignedMoney, fmtSignedYi } from "@/lib/format";

describe("format", () => {
  it("漲用紅(up)、跌用綠(down)", () => {
    expect(changeColorClass(1)).toBe("text-up");
    expect(changeColorClass(-1)).toBe("text-down");
    expect(changeColorClass(0)).toBe("text-gray-400");
  });
  it("價格與帶號百分比", () => {
    expect(fmtPrice(1085)).toBe("1,085.00");
    expect(fmtSignedPct(1.4)).toBe("+1.40%");
    expect(fmtSignedPct(-1.86)).toBe("-1.86%");
  });
});

describe("fmtMoney", () => {
  it("整數千分位", () => {
    expect(fmtMoney(1234567.4)).toBe("1,234,567");
  });
  it("負數", () => {
    expect(fmtMoney(-500.6)).toBe("-501");
  });
});

describe("fmtSignedYi", () => {
  it("元轉億,帶正負號,一位小數", () => {
    expect(fmtSignedYi(9_955_637_650)).toBe("+99.6");
    expect(fmtSignedYi(-89_046_513_677)).toBe("-890.5");
    expect(fmtSignedYi(0)).toBe("0.0");
  });
});

describe("fmtSignedMoney", () => {
  it("正數帶 +", () => {
    expect(fmtSignedMoney(1500)).toBe("+1,500");
  });
  it("負數", () => {
    expect(fmtSignedMoney(-1500)).toBe("-1,500");
  });
  it("零不帶符號", () => {
    expect(fmtSignedMoney(0)).toBe("0");
  });
});
