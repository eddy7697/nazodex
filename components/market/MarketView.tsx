"use client";
import { useCallback, useEffect, useState } from "react";
import type { MarketOverview } from "@/lib/market-overview/types";
import IndexCard from "@/components/market/IndexCard";
import BreadthBar from "@/components/market/BreadthBar";
import InstitutionalCard from "@/components/market/InstitutionalCard";
import SectorList from "@/components/market/SectorList";

function Section({ title, date, children }: { title: string; date?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-[var(--card)] p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-gray-300">{title}</h2>
        {date && <span className="text-xs text-gray-500">{date}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = () => <p className="text-sm text-gray-500">暫無資料</p>;

export default function MarketView() {
  const [data, setData] = useState<MarketOverview | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/market");
    if (!res.ok) return;
    setData(await res.json());
    setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // 每分鐘刷新(指數盤中即時,其餘每日)
    return () => clearInterval(id);
  }, [load]);

  if (!data) return <p className="text-gray-400">載入中⋯</p>;

  return (
    <div className="space-y-3">
      <div className="mb-2 text-right text-xs text-gray-500">更新於 {updatedAt}</div>

      {data.indices.length > 0 ? (
        <div className="flex gap-3">
          {data.indices.map((q) => <IndexCard key={q.symbol} quote={q} />)}
        </div>
      ) : (
        <Section title="指數"><Empty /></Section>
      )}

      <Section title="漲跌家數(上市股票)" date={data.breadth?.date}>
        {data.breadth ? <BreadthBar breadth={data.breadth} /> : <Empty />}
      </Section>

      <Section title="三大法人買賣超" date={data.institutional?.date}>
        {data.institutional ? <InstitutionalCard flow={data.institutional} /> : <Empty />}
      </Section>

      <Section title="強弱產業" date={data.sectors?.date}>
        {data.sectors ? <SectorList sectors={data.sectors.sectors} /> : <Empty />}
      </Section>
    </div>
  );
}
