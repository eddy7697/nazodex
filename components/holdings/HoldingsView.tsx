"use client";
import { useCallback, useEffect, useState } from "react";
import type { ApiPosition, ApiSummary } from "@/components/holdings/types";
import SummaryBar from "@/components/holdings/SummaryBar";
import PositionCard from "@/components/holdings/PositionCard";
import PositionRow from "@/components/holdings/PositionRow";
import AddTransaction from "@/components/holdings/AddTransaction";
import EmptyState from "@/components/ui/EmptyState";

export default function HoldingsView() {
  const [positions, setPositions] = useState<ApiPosition[]>([]);
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/holdings");
    if (!res.ok) return;
    const json = await res.json();
    setPositions(json.positions ?? []);
    setSummary(json.summary ?? null);
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // 每分鐘刷新
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <AddTransaction onAdded={load}
        sharesBySymbol={Object.fromEntries(positions.filter((p) => p.shares > 0).map((p) => [p.symbol, p.shares]))} />
      {summary && <SummaryBar summary={summary} />}
      <div className="mb-2 text-right text-xs text-gray-500">更新於 {updatedAt}</div>

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {positions.map((p) => (
          <PositionCard key={p.symbol} position={p}
            expanded={expanded === p.symbol}
            onToggle={() => setExpanded(expanded === p.symbol ? null : p.symbol)}
            onChanged={load} />
        ))}
      </div>

      {/* 電腦:表格 */}
      <table className="hidden w-full md:table">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th>名稱</th><th className="text-right">股數</th><th className="text-right">均價</th>
            <th className="text-right">現價</th><th className="text-right">市值</th>
            <th className="text-right">未實現損益</th><th className="text-right">報酬率</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.symbol} position={p}
              expanded={expanded === p.symbol}
              onToggle={() => setExpanded(expanded === p.symbol ? null : p.symbol)}
              onChanged={load} />
          ))}
        </tbody>
      </table>

      {positions.length === 0 && (
        <EmptyState variant="holdings">還沒有持股紀錄,點上面「＋ 記一筆買賣」開始追蹤損益。</EmptyState>
      )}
    </div>
  );
}
