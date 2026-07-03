import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  computePositions, validateNoOversell, type Position, type Side, type Txn,
} from "@/lib/holdings/positions";

type P = typeof defaultPrisma;

export class OversellError extends Error {
  constructor(symbol: string) {
    super(`持股不足:${symbol}`);
    this.name = "OversellError";
  }
}

export type NewTxnInput = {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  date: Date;
};

function toTxn(r: any): Txn {
  return {
    id: r.id, stockSymbol: r.stockSymbol, side: r.side as Side,
    quantity: r.quantity, price: r.price, fee: r.fee, tax: r.tax,
    date: new Date(r.date), createdAt: new Date(r.createdAt),
  };
}

export async function listTransactions(
  userId: string, symbol?: string, p: P = defaultPrisma,
): Promise<Txn[]> {
  const rows = await p.holdingTransaction.findMany({
    where: { userId, ...(symbol ? { stockSymbol: symbol } : {}) },
  });
  return rows.map(toTxn).sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export async function addTransaction(
  userId: string, input: NewTxnInput, p: P = defaultPrisma,
): Promise<void> {
  const existing = await listTransactions(userId, input.symbol, p);
  const candidate: Txn = {
    id: "candidate", stockSymbol: input.symbol, side: input.side,
    quantity: input.quantity, price: input.price, fee: input.fee, tax: input.tax,
    // 新輸入的交易在同一成交日內視為最後發生,用最大時間戳參與重放排序
    date: input.date, createdAt: new Date(8640000000000000),
  };
  const check = validateNoOversell([...existing, candidate]);
  if (!check.ok) throw new OversellError(check.symbol);
  await p.holdingTransaction.create({
    data: {
      userId, stockSymbol: input.symbol, side: input.side,
      quantity: input.quantity, price: input.price, fee: input.fee, tax: input.tax,
      date: input.date,
    },
  });
}

export async function deleteTransaction(
  userId: string, id: string, p: P = defaultPrisma,
): Promise<"deleted" | "not_found"> {
  const row = await p.holdingTransaction.findFirst({ where: { id, userId } });
  if (!row) return "not_found";
  // 刪掉買單可能讓其後的賣單超賣;先以剩餘交易重放驗證
  const remaining = (await listTransactions(userId, row.stockSymbol, p)).filter((t) => t.id !== id);
  const check = validateNoOversell(remaining);
  if (!check.ok) throw new OversellError(check.symbol);
  await p.holdingTransaction.delete({ where: { id } });
  return "deleted";
}

export async function getPositions(userId: string, p: P = defaultPrisma): Promise<Position[]> {
  return computePositions(await listTransactions(userId, undefined, p));
}
