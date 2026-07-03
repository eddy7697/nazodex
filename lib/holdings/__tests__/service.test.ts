import { describe, it, expect } from "vitest";
import {
  listTransactions, addTransaction, deleteTransaction, getPositions, OversellError,
} from "@/lib/holdings/service";

function makeMock() {
  const db: any[] = [];
  let seq = 0;
  return {
    _db: db,
    holdingTransaction: {
      findMany: async ({ where }: any) => {
        let rows = db.filter((r) => r.userId === where.userId);
        if (where.stockSymbol) rows = rows.filter((r) => r.stockSymbol === where.stockSymbol);
        return rows.map((r) => ({ ...r }));
      },
      findFirst: async ({ where }: any) => {
        const row = db.find((r) => r.id === where.id && r.userId === where.userId);
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => {
        seq += 1;
        db.push({ id: `t${seq}`, createdAt: new Date(2026, 0, 1, 9, 0, seq), ...data });
      },
      delete: async ({ where }: any) => {
        const i = db.findIndex((r) => r.id === where.id);
        if (i >= 0) db.splice(i, 1);
      },
    },
  } as any;
}

const buy = (over: any = {}) => ({
  symbol: "2330", side: "BUY" as const, quantity: 1000, price: 100,
  fee: 143, tax: 0, date: new Date("2026-01-01"), ...over,
});

describe("holdings service", () => {
  it("新增後可列出", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const list = await listTransactions("u1", undefined, p);
    expect(list.length).toBe(1);
    expect(list[0].stockSymbol).toBe("2330");
  });
  it("跨使用者隔離", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    expect(await listTransactions("u2", undefined, p)).toEqual([]);
  });
  it("symbol 過濾", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", buy({ symbol: "2454" }), p);
    const list = await listTransactions("u1", "2454", p);
    expect(list.map((t) => t.stockSymbol)).toEqual(["2454"]);
  });
  it("超賣被拒", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await expect(
      addTransaction("u1", buy({ side: "SELL", quantity: 1500, date: new Date("2026-02-01") }), p),
    ).rejects.toThrow(OversellError);
    expect((await listTransactions("u1", undefined, p)).length).toBe(1);
  });
  it("同日先買後賣(新交易視為同日最後):不算超賣", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", buy({ side: "SELL", quantity: 1000 }), p);
    expect((await listTransactions("u1", undefined, p)).length).toBe(2);
  });
  it("可刪除自己的交易", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const [t] = await listTransactions("u1", undefined, p);
    expect(await deleteTransaction("u1", t.id, p)).toBe("deleted");
    expect((await listTransactions("u1", undefined, p)).length).toBe(0);
  });
  it("刪不到別人的交易", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    const [t] = await listTransactions("u1", undefined, p);
    expect(await deleteTransaction("u2", t.id, p)).toBe("not_found");
    expect((await listTransactions("u1", undefined, p)).length).toBe(1);
  });
  it("刪買單導致後續賣單超賣:拒絕", async () => {
    const p = makeMock();
    await addTransaction("u1", buy(), p);
    await addTransaction("u1", buy({ side: "SELL", quantity: 1000, date: new Date("2026-02-01") }), p);
    const buyTxn = (await listTransactions("u1", undefined, p)).find((t) => t.side === "BUY")!;
    await expect(deleteTransaction("u1", buyTxn.id, p)).rejects.toThrow(OversellError);
  });
  it("getPositions 推導部位", async () => {
    const p = makeMock();
    await addTransaction("u1", buy({ fee: 0 }), p);
    const [pos] = await getPositions("u1", p);
    expect(pos).toMatchObject({ symbol: "2330", shares: 1000, avgCost: 100 });
  });
  it("listTransactions 依日期新到舊", async () => {
    const p = makeMock();
    await addTransaction("u1", buy({ date: new Date("2026-01-01") }), p);
    await addTransaction("u1", buy({ date: new Date("2026-03-01") }), p);
    await addTransaction("u1", buy({ date: new Date("2026-02-01") }), p);
    const list = await listTransactions("u1", undefined, p);
    expect(list.map((t) => t.date.toISOString().slice(0, 10))).toEqual([
      "2026-03-01", "2026-02-01", "2026-01-01",
    ]);
  });
});
