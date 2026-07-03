import type { Breadth } from "@/lib/market-overview/types";

// 上市股票漲跌家數:紅綠比例橫條 + 家數(含漲跌停)
export default function BreadthBar({ breadth }: { breadth: Breadth }) {
  const total = breadth.up + breadth.down + breadth.unchanged;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%");
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-700">
        <div data-testid="breadth-up-bar" className="bg-[var(--up)]" style={{ width: pct(breadth.up) }} />
        <div className="bg-gray-500" style={{ width: pct(breadth.unchanged) }} />
        <div className="bg-[var(--down)]" style={{ width: pct(breadth.down) }} />
      </div>
      <div className="mt-2 flex justify-between text-sm">
        <div>
          <span className="text-up font-bold">{breadth.up}</span>
          <span className="ml-1 text-xs text-gray-400">上漲(漲停 {breadth.limitUp})</span>
        </div>
        <div className="text-xs text-gray-400">平盤 {breadth.unchanged}</div>
        <div>
          <span className="text-down font-bold">{breadth.down}</span>
          <span className="ml-1 text-xs text-gray-400">下跌(跌停 {breadth.limitDown})</span>
        </div>
      </div>
    </div>
  );
}
