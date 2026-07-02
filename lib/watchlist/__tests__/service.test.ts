import { describe, it, expect } from "vitest";
import {
  listWatchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist,
} from "@/lib/watchlist/service";

function makeMock() {
  const db: any[] = [];
  return {
    _db: db,
    watchlistItem: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = db.filter((r) => r.userId === where.userId);
        if (orderBy?.sortOrder === "asc") rows = rows.sort((a, b) => a.sortOrder - b.sortOrder);
        return rows.map((r) => ({ ...r }));
      },
      upsert: async ({ where, create }: any) => {
        const exists = db.find(
          (r) => r.userId === where.userId_stockSymbol.userId &&
                 r.stockSymbol === where.userId_stockSymbol.stockSymbol,
        );
        if (!exists) db.push({ ...create });
      },
      deleteMany: async ({ where }: any) => {
        for (let i = db.length - 1; i >= 0; i--) {
          if (db[i].userId === where.userId && db[i].stockSymbol === where.stockSymbol) db.splice(i, 1);
        }
      },
      update: async ({ where, data }: any) => {
        const row = db.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
      },
    },
    $transaction: async (ops: any[]) => { for (const op of ops) await op; },
  } as any;
}

describe("watchlist service", () => {
  it("新增後可列出", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u1", p);
    expect(list.map((x) => x.stockSymbol)).toEqual(["2330"]);
  });
  it("跨使用者隔離:u2 看不到 u1 的清單", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u2", p);
    expect(list).toEqual([]);
  });
  it("重複新增不重覆", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await addToWatchlist("u1", "2330", p);
    const list = await listWatchlist("u1", p);
    expect(list.length).toBe(1);
  });
  it("可移除", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await removeFromWatchlist("u1", "2330", p);
    expect(await listWatchlist("u1", p)).toEqual([]);
  });
  it("重新排序更新 sortOrder", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await addToWatchlist("u1", "2454", p);
    await reorderWatchlist("u1", ["2454", "2330"], p);
    const list = await listWatchlist("u1", p);
    expect(list.map((x) => x.stockSymbol)).toEqual(["2454", "2330"]);
  });
  it("新增的項目 sortOrder 遞增(附加到最後)", async () => {
    const p = makeMock();
    await addToWatchlist("u1", "2330", p);
    await addToWatchlist("u1", "2454", p);
    await addToWatchlist("u1", "2412", p);
    const list = await listWatchlist("u1", p);
    expect(list.map((x) => x.stockSymbol)).toEqual(["2330", "2454", "2412"]);
  });
});
