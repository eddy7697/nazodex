import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FundamentalsSection from "@/components/stock/FundamentalsSection";
import type { RevenuePoint, EpsPoint } from "@/lib/fundamentals/service";

function makeRevenues(): RevenuePoint[] {
  const months = [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11",
    "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  ];
  return months.map((month, i) => ({
    month,
    revenueBillions: 1000 + i * 10,
    yoyPct: month === "2026-05" ? 30.09 : null,
    barPct: ((1000 + i * 10) / (1000 + 11 * 10)) * 100,
  }));
}

describe("FundamentalsSection", () => {
  it("含 12 個月資料 → 出現「月營收」與最新月份文字與 YoY", () => {
    render(<FundamentalsSection revenues={makeRevenues()} eps={[]} />);
    expect(screen.getByText(/月營收/)).toBeTruthy();
    expect(screen.getAllByText(/2026-05/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\+30\.09%/)).toBeTruthy();
  });

  it("revenues=[] eps=[] → render 結果為空", () => {
    const { container } = render(<FundamentalsSection revenues={[]} eps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("有 EPS 資料 → 出現 EPS 標題與季別 label", () => {
    const eps: EpsPoint[] = [
      { label: "2025 Q4", eps: 20.5 },
      { label: "2026 Q1", eps: 22.08 },
    ];
    render(<FundamentalsSection revenues={[]} eps={eps} />);
    expect(screen.getByText(/EPS/)).toBeTruthy();
    expect(screen.getByText("2026 Q1")).toBeTruthy();
  });
});
