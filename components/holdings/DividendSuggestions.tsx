"use client";
import { useEffect, useState } from "react";
import type { DividendSuggestion } from "@/lib/holdings/dividendSuggestions";
import type { TxPrefill } from "@/components/holdings/AddTransaction";
import { fmtMoney } from "@/lib/format";

type Suggestion = DividendSuggestion & { name: string };

// 除權息建議卡:actionable(已過除權息日、尚未記帳)可一鍵帶入交易表單;
// upcoming(未來事件,以目前持股估算)僅供預告,不可帶入。
export default function DividendSuggestions({
  onPrefill, refreshKey,
}: {
  onPrefill: (p: TxPrefill) => void; refreshKey: number;
}) {
  const [actionable, setActionable] = useState<Suggestion[]>([]);
  const [upcoming, setUpcoming] = useState<Suggestion[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/holdings/dividend-suggestions");
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        setActionable(json.actionable ?? []);
        setUpcoming(json.upcoming ?? []);
      } catch {
        // 失敗維持現狀(不擋記帳)
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  if (actionable.length === 0 && upcoming.length === 0) return null;

  function handlePrefill(s: Suggestion) {
    onPrefill({
      symbol: s.symbol, name: s.name, side: s.side,
      quantity: s.quantity, price: s.price, date: s.date, fee: s.fee, tax: s.tax,
    });
  }

  return (
    <div className="mb-4 space-y-2">
      {actionable.map((s) => (
        <div key={`${s.symbol}-${s.kind}-${s.exDate}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-[var(--card)] p-3">
          <div className="text-sm">
            <div className="font-bold text-amber-400">
              {s.name || s.symbol}（{s.symbol}）{s.kind === "CASH" ? "除息" : "除權"}
            </div>
            {s.kind === "CASH" ? (
              <div className="text-gray-300">
                {s.exDate} 除息 {s.price} 元/股 × 除息日持股 {fmtMoney(s.sharesAtEx)} 股 ≈ {fmtMoney(s.amount)} 元
                <span className="text-gray-500">
                  （扣費稅後入帳約 {fmtMoney(s.amount - s.fee - s.tax)} 元）
                </span>
              </div>
            ) : (
              <div className="text-gray-300">
                {s.exDate} 除權 每股配 {(s.sharesAtEx > 0 ? s.quantity / s.sharesAtEx : 0).toFixed(2)} 股,估配 {s.quantity} 股
              </div>
            )}
          </div>
          <button onClick={() => handlePrefill(s)}
            className="whitespace-nowrap rounded bg-amber-500/20 px-3 py-1.5 text-sm font-bold text-amber-400">
            帶入記帳
          </button>
        </div>
      ))}

      {upcoming.length > 0 && (
        <div className="rounded-lg bg-black/10 p-3 text-sm text-gray-400">
          <div className="mb-1 font-bold">即將除權息</div>
          <ul className="space-y-1">
            {upcoming.map((s) => (
              <li key={`${s.symbol}-${s.kind}-${s.exDate}`}>
                {s.name || s.symbol}（{s.symbol}）{s.exDate} {s.kind === "CASH" ? "除息" : "除權"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
