"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

type Bar = { time: string; open: number; high: number; low: number; close: number };

export default function PriceChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(60);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 320,
      layout: { background: { color: "transparent" }, textColor: "#9aa4b2" },
      grid: { horzLines: { color: "#ffffff10" }, vertLines: { color: "#ffffff10" } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#d92d20", downColor: "#12b76a",      // 紅漲綠跌
      borderUpColor: "#d92d20", borderDownColor: "#12b76a",
      wickUpColor: "#d92d20", wickDownColor: "#12b76a",
    });
    let alive = true;
    fetch(`/api/stocks/${symbol}/history?days=${days}`)
      .then((r) => r.json())
      .then((json) => { if (alive) series.setData((json.data ?? []) as Bar[]); });
    const onResize = () => chart.applyOptions({ width: ref.current?.clientWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => { alive = false; window.removeEventListener("resize", onResize); chart.remove(); };
  }, [symbol, days]);

  return (
    <div>
      <div className="mb-2 flex gap-2">
        {[30, 60, 120].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`rounded px-3 py-1 text-sm ${days === d ? "bg-white/10 font-bold" : "text-gray-400"}`}>
            {d}日
          </button>
        ))}
      </div>
      <div ref={ref} />
    </div>
  );
}
