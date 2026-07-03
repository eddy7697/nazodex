import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BreadthBar from "@/components/market/BreadthBar";

describe("BreadthBar", () => {
  it("顯示上漲/下跌/平盤家數與漲跌停,紅漲綠跌", () => {
    render(<BreadthBar breadth={{
      date: "2026-07-02", up: 649, limitUp: 54, down: 323, limitDown: 1, unchanged: 75,
    }} />);
    const up = screen.getByText("649");
    expect(up.className).toContain("text-up");
    const down = screen.getByText("323");
    expect(down.className).toContain("text-down");
    expect(screen.getByText(/漲停 54/)).toBeTruthy();
    expect(screen.getByText(/跌停 1/)).toBeTruthy();
    expect(screen.getByText(/75/)).toBeTruthy();
  });
  it("比例條寬度依家數比例", () => {
    render(<BreadthBar breadth={{
      date: "2026-07-02", up: 500, limitUp: 0, down: 250, limitDown: 0, unchanged: 250,
    }} />);
    const bar = screen.getByTestId("breadth-up-bar");
    expect(bar.style.width).toBe("50%");
  });
});
