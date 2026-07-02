import { isMarketOpen } from "@/lib/market/hours";
import { fetchIntradayQuotes } from "@/lib/quotes/misSource";
import { getDailyQuotesFromDb } from "@/lib/quotes/dbSource";
import type { Quote } from "@/lib/quotes/types";

export type QuoteDeps = {
  isOpen?: (now: Date) => boolean;
  intraday?: (symbols: string[]) => Promise<Quote[]>;
  db?: (symbols: string[]) => Promise<Quote[]>;
  now?: () => Date;
};

export async function getQuotes(symbols: string[], deps: QuoteDeps = {}): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const isOpen = deps.isOpen ?? isMarketOpen;
  const intraday = deps.intraday ?? ((s: string[]) => fetchIntradayQuotes(s));
  const db = deps.db ?? ((s: string[]) => getDailyQuotesFromDb(s));
  const now = (deps.now ?? (() => new Date()))();

  if (isOpen(now)) {
    try {
      const live = await intraday(symbols);
      if (live.length > 0) return live;
    } catch {
      // 回退 DB
    }
  }
  return db(symbols);
}
