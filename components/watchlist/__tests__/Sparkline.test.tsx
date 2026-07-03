import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Sparkline from "@/components/watchlist/Sparkline";

describe("Sparkline", () => {
  it("窗口上漲用 up 色、下跌用 down 色", () => {
    const up = render(<Sparkline closes={[100, 98, 105]} />);
    expect(up.container.querySelector("svg")!.getAttribute("class")).toContain("text-up");
    const down = render(<Sparkline closes={[105, 98, 100]} />);
    expect(down.container.querySelector("svg")!.getAttribute("class")).toContain("text-down");
  });

  it("polyline 用 currentColor(不寫死色碼)", () => {
    const { container } = render(<Sparkline closes={[1, 2]} />);
    expect(container.querySelector("polyline")!.getAttribute("stroke")).toBe("currentColor");
  });

  it("少於 2 點不渲染", () => {
    expect(render(<Sparkline closes={[100]} />).container.firstChild).toBeNull();
    expect(render(<Sparkline />).container.firstChild).toBeNull();
  });
});
