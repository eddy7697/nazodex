import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import DividendSuggestions from "@/components/holdings/DividendSuggestions";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(json: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => json })));
}

describe("DividendSuggestions", () => {
  it("有現金股利 actionable → 顯示金額文案與帶入按鈕,點擊呼叫 onPrefill", async () => {
    stubFetch({
      actionable: [{
        symbol: "2887", name: "台新金", kind: "CASH", side: "DIV_CASH",
        exDate: "2026-07-01", year: "114年",
        sharesAtEx: 3000, quantity: 3000, price: 1.2, amount: 3600,
        fee: 10, tax: 0, date: "2026-07-01",
      }],
      upcoming: [],
    });
    const onPrefill = vi.fn();
    render(<DividendSuggestions onPrefill={onPrefill} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText(/台新金/)).toBeTruthy());
    expect(screen.getByText(/2026-07-01/)).toBeTruthy();
    expect(screen.getByText(/1\.2/)).toBeTruthy();
    expect(screen.getByText(/3,000/)).toBeTruthy();
    expect(screen.getByText(/3,600/)).toBeTruthy();

    const btn = screen.getByRole("button", { name: "帶入記帳" });
    fireEvent.click(btn);
    expect(onPrefill).toHaveBeenCalledWith({
      symbol: "2887", name: "台新金", side: "DIV_CASH",
      quantity: 3000, price: 1.2, date: "2026-07-01", fee: 10, tax: 0,
    });
  });

  it("配股 actionable → 顯示每股配股與估配股數,帶入按鈕給 DIV_STOCK 預填", async () => {
    stubFetch({
      actionable: [{
        symbol: "2887", name: "台新金", kind: "STOCK", side: "DIV_STOCK",
        exDate: "2026-07-01", year: "114年",
        sharesAtEx: 3000, quantity: 30, price: 0, amount: 0,
        fee: 0, tax: 0, date: "2026-07-01",
      }],
      upcoming: [],
    });
    const onPrefill = vi.fn();
    render(<DividendSuggestions onPrefill={onPrefill} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText(/每股配/)).toBeTruthy());
    expect(screen.getByText(/0\.01/)).toBeTruthy();
    expect(screen.getByText(/估配 30 股/)).toBeTruthy();

    const btn = screen.getByRole("button", { name: "帶入記帳" });
    fireEvent.click(btn);
    expect(onPrefill).toHaveBeenCalledWith({
      symbol: "2887", name: "台新金", side: "DIV_STOCK",
      quantity: 30, price: 0, date: "2026-07-01", fee: 0, tax: 0,
    });
  });

  it("只有 upcoming → 顯示即將除權息區塊,不含帶入按鈕", async () => {
    stubFetch({
      actionable: [],
      upcoming: [{
        symbol: "2330", name: "台積電", kind: "CASH", side: "DIV_CASH",
        exDate: "2026-08-01", year: "114年",
        sharesAtEx: 1000, quantity: 1000, price: 3, amount: 3000,
        fee: 10, tax: 0, date: "2026-08-01",
      }],
    });
    render(<DividendSuggestions onPrefill={vi.fn()} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText(/即將/)).toBeTruthy());
    expect(screen.getByText(/台積電/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "帶入記帳" })).toBeNull();
  });

  it("actionable 與 upcoming 皆空 → 不渲染任何節點", async () => {
    stubFetch({ actionable: [], upcoming: [] });
    const { container } = render(<DividendSuggestions onPrefill={vi.fn()} refreshKey={0} />);
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0));
    expect(container.firstChild).toBeNull();
  });

  it("refreshKey 變化時重新 fetch", async () => {
    stubFetch({ actionable: [], upcoming: [] });
    const { rerender } = render(<DividendSuggestions onPrefill={vi.fn()} refreshKey={0} />);
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBe(1));
    rerender(<DividendSuggestions onPrefill={vi.fn()} refreshKey={1} />);
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.length).toBe(2));
  });
});
