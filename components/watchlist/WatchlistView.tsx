"use client";
import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DraggableAttributes } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Quote } from "@/lib/quotes/types";
import QuoteCard from "@/components/watchlist/QuoteCard";
import QuoteRow from "@/components/watchlist/QuoteRow";
import AddStock from "@/components/watchlist/AddStock";
import EmptyState from "@/components/ui/EmptyState";

type Item = { stockSymbol: string; sortOrder: number; quote: Quote | null };

function DragHandle({ listeners, attributes }: { listeners?: Record<string, unknown>; attributes: DraggableAttributes }) {
  // touch-none:拖曳時不觸發頁面捲動(手機)
  return (
    <button {...attributes} {...listeners} aria-label="拖曳排序"
      className="mr-2 cursor-grab touch-none px-1 text-gray-600">⠿</button>
  );
}

function SortableCard({ quote, closes, onRemove }: { quote: Quote; closes?: number[]; onRemove: (s: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: quote.symbol });
  return (
    <QuoteCard quote={quote} closes={closes} onRemove={onRemove} cardRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      dragHandle={<DragHandle listeners={listeners} attributes={attributes} />} />
  );
}

function SortableRow({ quote, closes, onRemove }: { quote: Quote; closes?: number[]; onRemove: (s: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: quote.symbol });
  return (
    <QuoteRow quote={quote} closes={closes} onRemove={onRemove} rowRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      dragHandle={<DragHandle listeners={listeners} attributes={attributes} />} />
  );
}

export default function WatchlistView() {
  const [items, setItems] = useState<Item[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    const res = await fetch("/api/watchlist");
    if (!res.ok) return;
    const json = await res.json();
    setItems(json.items ?? []);
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  const loadSparklines = useCallback(async () => {
    const res = await fetch("/api/watchlist/sparklines");
    if (!res.ok) return; // 失敗:不畫線,其餘照常
    const json = await res.json();
    setSparklines(json.sparklines ?? {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // 每分鐘刷新
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    loadSparklines(); // 每日資料,mount 抓一次即可
  }, [loadSparklines]);

  async function remove(symbol: string) {
    await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
    load();
    loadSparklines();
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.stockSymbol === active.id);
    const to = items.findIndex((i) => i.stockSymbol === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to);
    setItems(next); // 樂觀更新
    const res = await fetch("/api/watchlist/reorder", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: next.map((i) => i.stockSymbol) }),
    });
    if (!res.ok) load(); // 失敗回復伺服器順序
  }

  const quotes = items.map((i) => i.quote).filter((q): q is Quote => q != null);
  // 報價最新時戳落後現在 15 分鐘以上 → 顯示的是收盤/延遲資料(盤後或 MIS 失敗回退 DB)
  const newestAsOf = quotes.reduce((max, q) => Math.max(max, Date.parse(q.asOf) || 0), 0);
  const isStale = quotes.length > 0 && Date.now() - newestAsOf > 15 * 60_000;

  return (
    <div>
      <AddStock onAdded={() => { load(); loadSparklines(); }} />
      <div className="mb-2 text-right text-xs text-gray-500">
        {isStale && <span className="mr-2 rounded bg-white/5 px-1.5 py-0.5 text-gray-400">收盤資料(非即時)</span>}
        更新於 {updatedAt}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={quotes.map((q) => q.symbol)} strategy={verticalListSortingStrategy}>
          {/* 手機:卡片 */}
          <div className="space-y-2 md:hidden">
            {quotes.map((q) => <SortableCard key={q.symbol} quote={q} closes={sparklines[q.symbol]} onRemove={remove} />)}
          </div>

          {/* 電腦:表格 */}
          <table className="hidden w-full md:table">
            <thead className="text-left text-xs text-gray-500">
              <tr><th>名稱</th><th>近月</th><th className="text-right">成交</th><th className="text-right">漲跌幅</th><th className="text-right">量(張)</th><th></th></tr>
            </thead>
            <tbody>
              {quotes.map((q) => <SortableRow key={q.symbol} quote={q} closes={sparklines[q.symbol]} onRemove={remove} />)}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>

      {quotes.length === 0 && <EmptyState variant="watchlist">還沒有自選股,用上面的搜尋框加入吧。</EmptyState>}
    </div>
  );
}
