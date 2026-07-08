type Raw = Record<string, string>;

export type MonthRevenueRow = {
  symbol: string;
  month: string;   // ISO 該月 1 日
  revenue: bigint; // 千元(TWSE 原始單位)
  yoyPct: number | null;
};

export type QuarterEpsRow = {
  symbol: string;
  quarter: string; // ISO 季首日
  eps: number;
};

// 民國 "11505" → "2026-05-01"
function rocYmToIsoMonth(ym: string | undefined): string | null {
  const m = ym?.match(/^(\d{3})(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-01`;
}

function numOrNull(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseMonthRevenue(json: unknown): MonthRevenueRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: MonthRevenueRow[] = [];
  for (const r of arr) {
    const symbol = (r["公司代號"] ?? "").trim();
    const month = rocYmToIsoMonth(r["資料年月"]);
    const revenueStr = (r["營業收入-當月營收"] ?? "").replace(/,/g, "").trim();
    if (!symbol || !month || !/^-?\d+$/.test(revenueStr)) continue;
    out.push({
      symbol,
      month,
      revenue: BigInt(revenueStr),
      yoyPct: numOrNull(r["營業收入-去年同月增減(%)"]),
    });
  }
  return out;
}

const QUARTER_START: Record<string, string> = { "1": "01-01", "2": "04-01", "3": "07-01", "4": "10-01" };

export function parseQuarterlyEps(json: unknown): QuarterEpsRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: QuarterEpsRow[] = [];
  for (const r of arr) {
    const symbol = (r["公司代號"] ?? "").trim();
    const year = (r["年度"] ?? "").trim();
    const qStart = QUARTER_START[(r["季別"] ?? "").trim()];
    const eps = numOrNull(r["基本每股盈餘(元)"]);
    if (!symbol || !/^\d{3}$/.test(year) || !qStart || eps == null) continue;
    out.push({ symbol, quarter: `${Number(year) + 1911}-${qStart}`, eps });
  }
  return out;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TWSE OpenAPI failed: ${res.status} (${url})`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMonthRevenue(fetchImpl: typeof fetch = fetch): Promise<MonthRevenueRow[]> {
  return parseMonthRevenue(await fetchJson("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", fetchImpl));
}

export async function fetchQuarterlyEps(fetchImpl: typeof fetch = fetch): Promise<QuarterEpsRow[]> {
  return parseQuarterlyEps(await fetchJson("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", fetchImpl));
}
