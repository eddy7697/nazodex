import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import IndexBar from "@/components/watchlist/IndexBar";

afterEach(() => vi.unstubAllGlobals());

describe("IndexBar", () => {
  it("顯示指數名稱、點位與紅漲綠跌", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ indices: [
        { symbol: "t00", name: "加權指數", price: 23456.78, change: 123.4, changePct: 0.53, volume: 0, asOf: "x" },
        { symbol: "o00", name: "櫃買指數", price: 260.12, change: -1.2, changePct: -0.46, volume: 0, asOf: "x" },
      ] }),
    })));
    render(<IndexBar />);
    await waitFor(() => expect(screen.getByText("加權指數")).toBeTruthy());
    expect(screen.getByText("23,456.78").className).toContain("text-up");
    expect(screen.getByText("-0.46%").className).toContain("text-down");
  });

  it("API 失敗時整列隱藏", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const { container } = render(<IndexBar />);
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0));
    expect(container.firstChild).toBeNull();
  });
});
