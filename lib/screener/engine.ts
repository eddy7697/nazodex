import type { Condition, NumericField, Preset, ScreenerRow } from "@/lib/screener/types";

export function applyConditions(rows: ScreenerRow[], conditions: Condition[]): ScreenerRow[] {
  return rows.filter((r) =>
    conditions.every((c) => {
      const v = r[c.field];
      if (v == null) return false;
      return c.op === "gte" ? v >= c.value : v <= c.value;
    }),
  );
}

export function sortRows(rows: ScreenerRow[], field: NumericField, dir: "asc" | "desc"): ScreenerRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // null 一律排最後
    if (bv == null) return -1;
    return sign * (av - bv);
  });
}

export const PRESETS: Preset[] = [
  {
    key: "dividend", label: "高殖利率",
    conditions: [
      { field: "dividendYield", op: "gte", value: 5 },
      { field: "peRatio", op: "lte", value: 20 },
      { field: "volumeLots", op: "gte", value: 500 },
    ],
    sort: { field: "dividendYield", dir: "desc" },
  },
  {
    key: "value", label: "便宜好股",
    conditions: [
      { field: "peRatio", op: "lte", value: 12 },
      { field: "pbRatio", op: "lte", value: 1.5 },
      { field: "dividendYield", op: "gte", value: 3 },
    ],
    sort: { field: "peRatio", dir: "asc" },
  },
  {
    key: "momentum", label: "今日強勢",
    conditions: [
      { field: "changePct", op: "gte", value: 3 },
      { field: "volumeLots", op: "gte", value: 1000 },
    ],
    sort: { field: "changePct", dir: "desc" },
  },
];

// 條件面板的固定六列(方向固定,新手不用想 ≥/≤)
export const CONDITION_DEFS: {
  field: NumericField; op: "gte" | "lte"; label: string; unit: string; defaultValue: number;
}[] = [
  { field: "dividendYield", op: "gte", label: "殖利率 ≥", unit: "%", defaultValue: 5 },
  { field: "peRatio", op: "lte", label: "本益比 ≤", unit: "倍", defaultValue: 15 },
  { field: "pbRatio", op: "lte", label: "淨值比 ≤", unit: "倍", defaultValue: 1.5 },
  { field: "changePct", op: "gte", label: "今日漲幅 ≥", unit: "%", defaultValue: 3 },
  { field: "volumeLots", op: "gte", label: "成交量 ≥", unit: "張", defaultValue: 500 },
  { field: "close", op: "lte", label: "股價 ≤", unit: "元", defaultValue: 100 },
];
