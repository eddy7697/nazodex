import { describe, it, expect } from "vitest";
import { parseTwseDaily } from "@/lib/ingest/twseOpenApi";

const sample = [
  {
    Code: "2330", Name: "台積電",
    OpeningPrice: "1080.00", HighestPrice: "1090.00",
    LowestPrice: "1075.00", ClosingPrice: "1085.00", TradeVolume: "21000000",
  },
  { Code: "", Name: "", ClosingPrice: "-", TradeVolume: "-" }, // 應被略過
];

describe("parseTwseDaily", () => {
  it("解析有效列,略過無效列", () => {
    const rows = parseTwseDaily(sample);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "2330", name: "台積電", close: 1085, open: 1080 });
    expect(rows[0].volume).toBe(21000000);
  });
});

const sampleWithChange = [
  {
    Date: "1150702", Code: "2330", Name: "台積電",
    OpeningPrice: "1080.00", HighestPrice: "1090.00",
    LowestPrice: "1075.00", ClosingPrice: "1085.00", TradeVolume: "21000000",
    Change: "-15.0000",
  },
];

describe("parseTwseDaily change/date", () => {
  it("解析漲跌價差與 ISO 日期", () => {
    const rows = parseTwseDaily(sampleWithChange);
    expect(rows[0].change).toBe(-15);
    expect(rows[0].date).toBe("2026-07-02");
  });
  it("缺 Change/Date 時為 null(舊 fixture 無此欄)", () => {
    const rows = parseTwseDaily(sample);
    expect(rows[0].change).toBeNull();
    expect(rows[0].date).toBeNull();
  });
});
