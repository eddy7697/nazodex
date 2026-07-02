import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QuoteCard from "@/components/watchlist/QuoteCard";

describe("QuoteCard", () => {
  it("顯示名稱、代號、價格與漲跌,漲用 up 色", () => {
    render(<QuoteCard quote={{
      symbol: "2330", name: "台積電", price: 1085, change: 15, changePct: 1.4, volume: 21000, asOf: "x",
    }} onRemove={() => {}} />);
    expect(screen.getByText("台積電")).toBeTruthy();
    expect(screen.getByText("2330")).toBeTruthy();
    const pct = screen.getByText("+1.40%");
    expect(pct.className).toContain("text-up");
  });
});
