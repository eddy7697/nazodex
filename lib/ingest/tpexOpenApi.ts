import { rocToIso, num } from "./twseOpenApi";

export type TpexDailyRow = {
  symbol: string; name: string;
  open: number; high: number; low: number; close: number;
  volume: number;          // 股
  date: string | null;     // ISO 資料日期
};

type Raw = Record<string, string>;

// 4 碼數字(普通股與 ETF)或 00 開頭(ETF),含特別股/債券與槓反 ETF 的尾碼字母;排除權證等長代號
const SYMBOL_RE = /^(\d{4}|00\d{3,4})[A-Z]?$/;

export function parseTpexDaily(json: unknown): TpexDailyRow[] {
  const arr = Array.isArray(json) ? (json as Raw[]) : [];
  const out: TpexDailyRow[] = [];
  for (const r of arr) {
    const symbol = (r.SecuritiesCompanyCode ?? "").trim();
    const close = num(r.Close);
    if (!SYMBOL_RE.test(symbol) || close == null) continue; // 權證/指數/無成交列跳過
    out.push({
      symbol,
      name: (r.CompanyName ?? "").trim(),
      open: num(r.Open) ?? close,
      high: num(r.High) ?? close,
      low: num(r.Low) ?? close,
      close,
      volume: num(r.TradingShares) ?? 0,
      date: rocToIso(r.Date),
    });
  }
  return out;
}

export async function fetchTpexDaily(fetchImpl: typeof fetch = fetch): Promise<TpexDailyRow[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TPEX OpenAPI failed: ${res.status}`);
    return parseTpexDaily(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
