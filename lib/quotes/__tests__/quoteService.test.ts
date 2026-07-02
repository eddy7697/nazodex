import { describe, it, expect, vi } from "vitest";
import { getQuotes } from "@/lib/quotes/quoteService";
import type { Quote } from "@/lib/quotes/types";

const q = (symbol: string, src: string): Quote => ({
  symbol, name: src, price: 1, change: 0, changePct: 0, volume: 0, asOf: "x",
});

describe("getQuotes", () => {
  it("盤中優先用即時來源", async () => {
    const intraday = vi.fn(async () => [q("2330", "intraday")]);
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => true, intraday, db });
    expect(out[0].name).toBe("intraday");
    expect(db).not.toHaveBeenCalled();
  });
  it("盤中即時來源失敗時回退 DB", async () => {
    const intraday = vi.fn(async () => { throw new Error("boom"); });
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => true, intraday, db });
    expect(out[0].name).toBe("db");
  });
  it("盤後直接用 DB", async () => {
    const intraday = vi.fn(async () => [q("2330", "intraday")]);
    const db = vi.fn(async () => [q("2330", "db")]);
    const out = await getQuotes(["2330"], { isOpen: () => false, intraday, db });
    expect(out[0].name).toBe("db");
    expect(intraday).not.toHaveBeenCalled();
  });
});
