import { describe, it, expect } from "vitest";
import { toRevenuePoints, toEpsPoints } from "@/lib/fundamentals/service";

describe("toRevenuePoints", () => {
  it("千元轉億元、相對最大值算 barPct、輸出舊→新", () => {
    const pts = toRevenuePoints([
      { month: new Date("2026-05-01T00:00:00Z"), revenue: 416975163n, yoyPct: 30.09 },
      { month: new Date("2026-04-01T00:00:00Z"), revenue: 208487581n, yoyPct: null },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[0].month).toBe("2026-04"); // 舊→新
    expect(pts[1].revenueBillions).toBeCloseTo(4169.75, 1);
    expect(pts[1].barPct).toBe(100);
    expect(pts[0].barPct).toBeCloseTo(50, 0);
    expect(pts[0].yoyPct).toBeNull();
  });
  it("空輸入回 []", () => {
    expect(toRevenuePoints([])).toEqual([]);
  });
});

describe("toEpsPoints", () => {
  it("季首日轉 label、輸出舊→新", () => {
    const pts = toEpsPoints([
      { quarter: new Date("2026-01-01T00:00:00Z"), eps: 22.08 },
      { quarter: new Date("2025-10-01T00:00:00Z"), eps: 20.5 },
    ]);
    expect(pts[0]).toEqual({ label: "2025 Q4", eps: 20.5 });
    expect(pts[1]).toEqual({ label: "2026 Q1", eps: 22.08 });
  });
});
