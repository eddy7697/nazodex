export type ScreenerRow = {
  symbol: string;
  name: string;
  close: number;
  changePct: number | null;
  volumeLots: number;                // 成交張數(股/1000 取整)
  peRatio: number | null;
  dividendYield: number | null;
  pbRatio: number | null;
};

export type NumericField = "close" | "changePct" | "volumeLots" | "peRatio" | "dividendYield" | "pbRatio";

export type Condition = { field: NumericField; op: "gte" | "lte"; value: number };

export type Preset = {
  key: string;
  label: string;
  conditions: Condition[];
  sort: { field: NumericField; dir: "asc" | "desc" };
};

export type ScreenerSnapshot = { date: string | null; rows: ScreenerRow[] };
