import type { Txn } from "@/lib/holdings/positions";
import { DIV_TRANSFER_FEE, estimateNhi } from "@/lib/holdings/fees";

export type DividendEventLike = {
  stockSymbol: string; kind: "CASH" | "STOCK";
  exDate: Date; perShare: number; paymentDate: Date | null; year: string;
};

export type DividendSuggestion = {
  symbol: string; kind: "CASH" | "STOCK"; side: "DIV_CASH" | "DIV_STOCK";
  exDate: string; year: string;
  sharesAtEx: number; quantity: number; price: number; amount: number;
  fee: number; tax: number; date: string;
};

// 除權息日前一日的持股:重放嚴格早於 date 的交易(現金股利不影響股數)
export function sharesAsOf(txns: Txn[], symbol: string, date: Date): number {
  let shares = 0;
  for (const t of txns) {
    if (t.stockSymbol !== symbol || t.side === "DIV_CASH") continue;
    if (t.date.getTime() >= date.getTime()) continue;
    shares += t.side === "SELL" ? -t.quantity : t.quantity;
  }
  return shares;
}

const RECORD_WINDOW_BEFORE = 7 * 86_400_000;
const RECORD_WINDOW_AFTER = 120 * 86_400_000; // 現金發放常在除息後 1 個月+,使用者可能以入帳日記帳

// 季配息 ETF(0056/00878/00919 等)同代號同型別的相鄰兩期間隔(~91 天)落在判定窗(127 天)內,
// 單純用「日期落在窗內」會讓一筆交易同時判定兩期已記帳。改以「錨定日(paymentDate ?? exDate)
// 最近」把交易唯一分派給一個事件;窗口資格仍須滿足,只是不再是唯一條件。
const anchorMs = (e: DividendEventLike) => (e.paymentDate ?? e.exDate).getTime();

function nearestEvent(t: Txn, candidates: DividendEventLike[]): DividendEventLike | null {
  let best: DividendEventLike | null = null;
  let bestDist = Infinity;
  for (const ev of candidates) {
    const dist = Math.abs(t.date.getTime() - anchorMs(ev));
    // 距離相同時取較早的事件(exDate 較小)
    if (dist < bestDist || (dist === bestDist && best && ev.exDate.getTime() < best.exDate.getTime())) {
      best = ev;
      bestDist = dist;
    }
  }
  return best;
}

function isRecorded(txns: Txn[], e: DividendEventLike, candidates: DividendEventLike[]): boolean {
  const side = e.kind === "CASH" ? "DIV_CASH" : "DIV_STOCK";
  return txns.some((t) => {
    if (t.stockSymbol !== e.stockSymbol || t.side !== side) return false;
    if (t.date.getTime() < e.exDate.getTime() - RECORD_WINDOW_BEFORE) return false;
    if (t.date.getTime() > e.exDate.getTime() + RECORD_WINDOW_AFTER) return false;
    return nearestEvent(t, candidates) === e;
  });
}

const iso = (dt: Date) => dt.toISOString().slice(0, 10);

function toSuggestion(e: DividendEventLike, sharesAtEx: number): DividendSuggestion | null {
  if (e.kind === "CASH") {
    const amount = Math.round(sharesAtEx * e.perShare);
    if (amount <= 0) return null;
    return {
      symbol: e.stockSymbol, kind: "CASH", side: "DIV_CASH", exDate: iso(e.exDate), year: e.year,
      sharesAtEx, quantity: sharesAtEx, price: e.perShare, amount,
      fee: DIV_TRANSFER_FEE, tax: estimateNhi(amount),
      date: iso(e.paymentDate ?? e.exDate),
    };
  }
  const shares = Math.floor((sharesAtEx * e.perShare) / 10); // 面額 10 元:股票股利 X 元 = 每股配 X/10 股;畸零捨去
  if (shares <= 0) return null;
  return {
    symbol: e.stockSymbol, kind: "STOCK", side: "DIV_STOCK", exDate: iso(e.exDate), year: e.year,
    sharesAtEx, quantity: shares, price: 0, amount: 0, fee: 0, tax: 0, date: iso(e.exDate),
  };
}

const groupKey = (symbol: string, kind: "CASH" | "STOCK") => `${symbol}|${kind}`;

export function buildDividendSuggestions(
  txns: Txn[], events: DividendEventLike[], today: Date,
): { actionable: DividendSuggestion[]; upcoming: DividendSuggestion[] } {
  const byGroup = new Map<string, DividendEventLike[]>();
  for (const e of events) {
    const key = groupKey(e.stockSymbol, e.kind);
    const arr = byGroup.get(key);
    if (arr) arr.push(e); else byGroup.set(key, [e]);
  }
  const actionable: DividendSuggestion[] = [];
  const upcoming: DividendSuggestion[] = [];
  for (const e of [...events].sort((a, b) => a.exDate.getTime() - b.exDate.getTime())) {
    if (e.exDate.getTime() <= today.getTime()) {
      const candidates = byGroup.get(groupKey(e.stockSymbol, e.kind))!;
      if (isRecorded(txns, e, candidates)) continue;
      const s = toSuggestion(e, sharesAsOf(txns, e.stockSymbol, e.exDate));
      if (s) actionable.push(s);
    } else {
      // 未來事件:以今日持股估算預告(僅展示,不可帶入)
      const s = toSuggestion(e, sharesAsOf(txns, e.stockSymbol, today));
      if (s) upcoming.push(s);
    }
  }
  return { actionable, upcoming };
}
