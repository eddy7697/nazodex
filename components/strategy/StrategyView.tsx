"use client";
import { useEffect, useMemo, useState } from "react";
import { recommend, STRATEGIES } from "@/lib/strategy/engine";
import type { StrategySnapshot, Weights } from "@/lib/strategy/types";
import StrategyCard from "@/components/strategy/StrategyCard";
import WeightPanel from "@/components/strategy/WeightPanel";
import EmptyState from "@/components/ui/EmptyState";

const DEFAULT = STRATEGIES[0];
const TOP_N = 20;

export default function StrategyView() {
  const [snapshot, setSnapshot] = useState<StrategySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeKey, setActiveKey] = useState(DEFAULT.key);
  const [weights, setWeights] = useState<Weights>(DEFAULT.weights);
  const [panelOpen, setPanelOpen] = useState(false);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/strategy")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setSnapshot)
      .catch(() => setFailed(true));
    // 已在自選的股票顯示 ✓,避免重複加入(同 screener)
    fetch("/api/watchlist")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => setWatched(new Set((json.items ?? []).map((i: { stockSymbol: string }) => i.stockSymbol))))
      .catch(() => {});
  }, []);

  async function addToWatchlist(symbol: string) {
    setWatched((w) => new Set(w).add(symbol)); // 樂觀更新
    const res = await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) setWatched((w) => { const next = new Set(w); next.delete(symbol); return next; });
  }

  const recs = useMemo(
    () => (snapshot ? recommend(snapshot.rows, weights, TOP_N) : []),
    [snapshot, weights],
  );

  function applyStrategy(key: string) {
    const s = STRATEGIES.find((x) => x.key === key)!;
    setActiveKey(key);
    setWeights(s.weights);
  }

  if (failed) return <EmptyState variant="closed">暫無資料,稍後再試</EmptyState>;
  if (!snapshot) return <p className="text-gray-400">載入中⋯</p>;

  const active = STRATEGIES.find((s) => s.key === activeKey);
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm ${on ? "bg-white/10 text-up font-bold" : "bg-[var(--card)] text-gray-300"}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {STRATEGIES.map((s) => (
            <button key={s.key} onClick={() => applyStrategy(s.key)} className={chip(activeKey === s.key)}>
              {s.label}
            </button>
          ))}
          <button onClick={() => { setActiveKey("custom"); setPanelOpen(true); }} className={chip(activeKey === "custom")}>
            自訂配方
          </button>
        </div>
        {snapshot.date && <span className="text-xs text-gray-500">{snapshot.date}</span>}
      </div>

      <p className="text-xs text-gray-500">{activeKey === "custom" ? "自己調配五力權重" : active?.blurb}</p>

      <button onClick={() => setPanelOpen((o) => !o)} className="text-sm text-gray-400">
        {panelOpen ? "▾ 收合配方" : "▸ 調整配方"}
      </button>
      {panelOpen && (
        <WeightPanel weights={weights} onChange={(w) => { setWeights(w); setActiveKey("custom"); }} />
      )}

      <div className="grid gap-2 md:grid-cols-2">
        {recs.map((rec, i) => (
          <StrategyCard key={rec.row.symbol} rank={i + 1} rec={rec} watched={watched} onAdd={addToWatchlist} />
        ))}
      </div>
      {recs.length === 0 && <EmptyState variant="screener">今日無符合條件的標的</EmptyState>}

      <p className="pb-2 text-center text-xs text-gray-600">依公開市場數據計算,僅供學習參考,非投資建議</p>
    </div>
  );
}
