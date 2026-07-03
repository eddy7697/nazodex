"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Quote } from "@/lib/quotes/types";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";

// 首頁頂端大盤指數列。取不到資料整列隱藏,不擋看盤;點擊進 /market。
export default function IndexBar() {
  const [indices, setIndices] = useState<Quote[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/market/indices");
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setIndices(json.indices ?? []);
      } catch {
        // 失敗維持現狀(初始為空 → 隱藏)
      }
    };
    load();
    const id = setInterval(load, 60_000); // 與自選報價同頻
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (indices.length === 0) return null;
  return (
    <Link href="/market" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[var(--card)] px-4 py-2 text-sm">
      {indices.map((q) => (
        <span key={q.symbol} className="flex items-baseline gap-2">
          <span className="text-gray-400">{q.name}</span>
          <span className={`font-bold ${changeColorClass(q.change)}`}>{fmtPrice(q.price)}</span>
          <span className={changeColorClass(q.change)}>{fmtSignedPct(q.changePct)}</span>
        </span>
      ))}
    </Link>
  );
}
