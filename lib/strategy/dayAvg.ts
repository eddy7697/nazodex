type Raw = Record<string, string>;
export type DayAvgRow = { symbol: string; close: number; monthlyAvg: number };

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDayAvg(json: unknown): DayAvgRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: DayAvgRow[] = [];
  for (const r of arr) {
    const symbol = (r.Code ?? "").trim();
    const close = num(r.ClosingPrice);
    const monthlyAvg = num(r.MonthlyAveragePrice);
    if (!symbol || close == null || monthlyAvg == null || monthlyAvg <= 0) continue;
    out.push({ symbol, close, monthlyAvg });
  }
  return out;
}

export async function fetchDayAvg(fetchImpl: typeof fetch = fetch): Promise<DayAvgRow[]> {
  // 8s abort,避免上游卡住(同 twseOpenApi 模式)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status}`);
    return parseDayAvg(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
