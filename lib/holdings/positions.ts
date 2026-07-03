export type Side = "BUY" | "SELL" | "DIV_CASH" | "DIV_STOCK";

export type Txn = {
  id: string;
  stockSymbol: string;
  side: Side;
  quantity: number;   // 股數
  price: number;      // 每股成交價
  fee: number;        // 手續費(元)
  tax: number;        // 證交稅(元)
  date: Date;         // 成交日
  createdAt: Date;    // 同日交易的次序依此
};

export type Position = {
  symbol: string;
  shares: number;
  totalCost: number;    // 剩餘持股的總成本(含買進手續費)
  avgCost: number;      // totalCost / shares(空手為 0)
  realizedPnl: number;  // 已實現損益(扣賣出費稅)
  dividendIncome: number; // 累計實收現金股利(扣匯費/健保補充費)
};

export type Summary = {
  marketValue: number;
  totalCost: number;
  unrealizedPnl: number;
  returnPct: number;    // 未實現 / 成本 * 100
  realizedPnl: number;
  dividendIncome: number; // 全部位累計股利(含已出清)
};

function chronological(txns: Txn[]): Txn[] {
  return [...txns].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

// 平均成本法:買進累加成本(含手續費),賣出以當下均價認列已實現損益並等比減少成本。
export function computePositions(txns: Txn[]): Position[] {
  const bySymbol = new Map<string, { shares: number; totalCost: number; realizedPnl: number; dividendIncome: number }>();
  for (const t of chronological(txns)) {
    const pos = bySymbol.get(t.stockSymbol) ?? { shares: 0, totalCost: 0, realizedPnl: 0, dividendIncome: 0 };
    if (t.side === "BUY") {
      pos.shares += t.quantity;
      pos.totalCost += t.quantity * t.price + t.fee;
    } else if (t.side === "SELL") {
      const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
      pos.realizedPnl += t.quantity * t.price - t.fee - t.tax - avgCost * t.quantity;
      pos.shares -= t.quantity;
      pos.totalCost -= avgCost * t.quantity;
    } else if (t.side === "DIV_CASH") {
      pos.dividendIncome += t.quantity * t.price - t.fee - t.tax;
    } else {
      // DIV_STOCK 配股:股數增、成本不變 → 均價自然稀釋
      pos.shares += t.quantity;
    }
    bySymbol.set(t.stockSymbol, pos);
  }
  return [...bySymbol.entries()].map(([symbol, p]) => ({
    symbol,
    shares: p.shares,
    totalCost: p.totalCost,
    avgCost: p.shares > 0 ? p.totalCost / p.shares : 0,
    realizedPnl: p.realizedPnl,
    dividendIncome: p.dividendIncome,
  }));
}

export function validateNoOversell(txns: Txn[]): { ok: true } | { ok: false; symbol: string } {
  const shares = new Map<string, number>();
  for (const t of chronological(txns)) {
    if (t.side === "DIV_CASH") continue; // 現金股利不影響股數
    const cur = shares.get(t.stockSymbol) ?? 0;
    const next = t.side === "SELL" ? cur - t.quantity : cur + t.quantity; // BUY 與 DIV_STOCK 皆加股
    if (next < 0) return { ok: false, symbol: t.stockSymbol };
    shares.set(t.stockSymbol, next);
  }
  return { ok: true };
}

export function computeSummary(
  positions: Position[],
  quotes: Map<string, { price: number }>,
): Summary {
  let marketValue = 0;
  let totalCost = 0;
  let realizedPnl = 0;
  let dividendIncome = 0;
  for (const p of positions) {
    realizedPnl += p.realizedPnl;
    dividendIncome += p.dividendIncome;
    if (p.shares <= 0) continue;
    const quote = quotes.get(p.symbol);
    if (!quote) continue; // 無報價(如下市):不計入市值與未實現,前端另行標示
    marketValue += quote.price * p.shares;
    totalCost += p.totalCost;
  }
  const unrealizedPnl = marketValue - totalCost;
  return {
    marketValue,
    totalCost,
    unrealizedPnl,
    returnPct: totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0,
    realizedPnl,
    dividendIncome,
  };
}
