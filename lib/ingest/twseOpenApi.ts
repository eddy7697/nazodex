type Raw = Record<string, string>;
export type DailyRow = {
  symbol: string; name: string;
  open: number; high: number; low: number; close: number; volume: number;
  change: number | null;      // 漲跌價差(帶正負);缺值 null
  date: string | null;        // ISO 資料日期(民國轉換);缺值 null
};

// 民國 "1150702" → "2026-07-02"
function rocToIso(d: string | undefined): string | null {
  const m = d?.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseTwseDaily(json: unknown): DailyRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: DailyRow[] = [];
  for (const r of arr) {
    const symbol = (r.Code ?? "").trim();
    const close = num(r.ClosingPrice);
    if (!symbol || close == null) continue;
    out.push({
      symbol,
      name: (r.Name ?? "").trim(),
      open: num(r.OpeningPrice) ?? close,
      high: num(r.HighestPrice) ?? close,
      low: num(r.LowestPrice) ?? close,
      close,
      volume: num(r.TradeVolume) ?? 0,
      change: num(r.Change),
      date: rocToIso(r.Date),
    });
  }
  return out;
}

export async function fetchTwseDaily(fetchImpl: typeof fetch = fetch): Promise<DailyRow[]> {
  // Abort a hung upstream connection so callers aren't stuck waiting forever. Only wired
  // for the default fetch; injected test fakes ignore the extra `signal` option.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status}`);
    return parseTwseDaily(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
