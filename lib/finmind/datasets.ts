import type { FinMindClient } from "./client";

export type FinMindPriceRow = {
  date: string; // ISO YYYY-MM-DD
  open: number; high: number; low: number; close: number;
  volume: number; // 股
};

type RawPrice = { date?: string; open?: number; max?: number; min?: number; close?: number; Trading_Volume?: number };

export function parseStockPrice(raw: unknown[]): FinMindPriceRow[] {
  const out: FinMindPriceRow[] = [];
  for (const r of raw as RawPrice[]) {
    const close = Number(r.close);
    const date = r.date ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue; // 停牌/無效列
    out.push({
      date,
      open: Number(r.open) > 0 ? Number(r.open) : close,
      high: Number(r.max) > 0 ? Number(r.max) : close,
      low: Number(r.min) > 0 ? Number(r.min) : close,
      close,
      volume: Number.isFinite(Number(r.Trading_Volume)) ? Number(r.Trading_Volume) : 0,
    });
  }
  return out;
}

export async function getStockPrice(
  client: FinMindClient, symbol: string, startDate: string, endDate: string,
): Promise<FinMindPriceRow[]> {
  const raw = await client.fetchDataset({ dataset: "TaiwanStockPrice", data_id: symbol, start_date: startDate, end_date: endDate });
  return parseStockPrice(raw);
}

export type FinMindStockInfo = {
  symbol: string; name: string;
  market: "TSE" | "OTC";
  industry: string | null;
};

type RawInfo = { industry_category?: string; stock_id?: string; stock_name?: string; type?: string };

// 4 碼數字(普通股與 0050 類 ETF)或 00 開頭 5–6 碼(ETF),含特別股/債券與槓反 ETF 的尾碼字母;排除權證/指數等其他代號
const SYMBOL_RE = /^(\d{4}|00\d{3,4})[A-Z]?$/;

export function parseStockInfo(raw: unknown[]): FinMindStockInfo[] {
  const seen = new Set<string>();
  const out: FinMindStockInfo[] = [];
  for (const r of raw as RawInfo[]) {
    const symbol = (r.stock_id ?? "").trim();
    const type = r.type;
    if (!SYMBOL_RE.test(symbol) || (type !== "twse" && type !== "tpex") || seen.has(symbol)) continue;
    seen.add(symbol);
    const industry = (r.industry_category ?? "").trim();
    out.push({
      symbol,
      name: (r.stock_name ?? "").trim(),
      market: type === "twse" ? "TSE" : "OTC",
      industry: industry || null,
    });
  }
  return out;
}

export async function getStockInfo(client: FinMindClient): Promise<FinMindStockInfo[]> {
  const raw = await client.fetchDataset({ dataset: "TaiwanStockInfo" });
  return parseStockInfo(raw);
}

export type FinMindDividendEvent = {
  symbol: string;
  kind: "CASH" | "STOCK";
  exDate: string;              // ISO 除息/除權交易日
  perShare: number;            // CASH:元/股;STOCK:面額元/股(每股配 perShare/10 股)
  paymentDate: string | null;  // 現金發放日
  year: string;                // 股利所屬年度("114年")
};

type RawDividend = Record<string, unknown>;

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const numOr0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseDividends(raw: unknown[]): FinMindDividendEvent[] {
  const out: FinMindDividendEvent[] = [];
  for (const r of raw as RawDividend[]) {
    const symbol = String(r.stock_id ?? "").trim();
    const year = String(r.year ?? "").trim();
    if (!symbol) continue;
    const cash = numOr0(r.CashEarningsDistribution) + numOr0(r.CashStatutorySurplus);
    if (cash > 0 && isIsoDate(r.CashExDividendTradingDate)) {
      out.push({
        symbol, kind: "CASH", exDate: r.CashExDividendTradingDate, perShare: cash,
        paymentDate: isIsoDate(r.CashDividendPaymentDate) ? r.CashDividendPaymentDate : null, year,
      });
    }
    const stock = numOr0(r.StockEarningsDistribution) + numOr0(r.StockStatutorySurplus);
    if (stock > 0 && isIsoDate(r.StockExDividendTradingDate)) {
      out.push({ symbol, kind: "STOCK", exDate: r.StockExDividendTradingDate, perShare: stock, paymentDate: null, year });
    }
  }
  return out;
}

export async function getDividends(client: FinMindClient, symbol: string, startDate: string): Promise<FinMindDividendEvent[]> {
  const raw = await client.fetchDataset({ dataset: "TaiwanStockDividend", data_id: symbol, start_date: startDate });
  return parseDividends(raw);
}
