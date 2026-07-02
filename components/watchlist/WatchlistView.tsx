"use client";
import { useCallback, useEffect, useState } from "react";
import type { Quote } from "@/lib/quotes/types";
import QuoteCard from "@/components/watchlist/QuoteCard";
import QuoteRow from "@/components/watchlist/QuoteRow";
import AddStock from "@/components/watchlist/AddStock";

type Item = { stockSymbol: string; sortOrder: number; quote: Quote | null };

export default function WatchlistView() {
  const [items, setItems] = useState<Item[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/watchlist");
    if (!res.ok) return;
    const json = await res.json();
    setItems(json.items ?? []);
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // 每分鐘刷新
    return () => clearInterval(id);
  }, [load]);

  async function remove(symbol: string) {
    await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
    load();
  }

  const quotes = items.map((i) => i.quote).filter((q): q is Quote => q != null);

  return (
    <div>
      <AddStock onAdded={load} />
      <div className="mb-2 text-right text-xs text-gray-500">更新於 {updatedAt}</div>

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {quotes.map((q) => <QuoteCard key={q.symbol} quote={q} onRemove={remove} />)}
      </div>

      {/* 電腦:表格 */}
      <table className="hidden w-full md:table">
        <thead className="text-left text-xs text-gray-500">
          <tr><th>名稱</th><th className="text-right">成交</th><th className="text-right">漲跌幅</th><th className="text-right">量</th><th></th></tr>
        </thead>
        <tbody>
          {quotes.map((q) => <QuoteRow key={q.symbol} quote={q} onRemove={remove} />)}
        </tbody>
      </table>

      {quotes.length === 0 && <p className="text-gray-400">還沒有自選股,用上面的搜尋框加入吧。</p>}
    </div>
  );
}
