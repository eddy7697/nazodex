import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyState from "@/components/ui/EmptyState";

describe("EmptyState", () => {
  it("依 variant 渲染對應圖片與文案", () => {
    const { container } = render(<EmptyState variant="watchlist">還沒有自選股</EmptyState>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/empty/watchlist.webp");
    expect(screen.getByText("還沒有自選股")).toBeTruthy();
  });
  it("closed variant 用休市圖", () => {
    const { container } = render(<EmptyState variant="closed">暫無資料</EmptyState>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/empty/market-closed.webp");
  });
});
