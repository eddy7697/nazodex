import { sparklinePoints } from "@/lib/sparkline";
import { changeColorClass } from "@/lib/format";

// 近月收盤迷你走勢線。顏色依「窗口首尾」漲跌(非當日漲跌),經 changeColorClass
// 套 text-up/text-down,線色用 currentColor 繼承,遵守不寫死 hex 的慣例。
export default function Sparkline({
  closes, width = 64, height = 24,
}: { closes?: number[]; width?: number; height?: number }) {
  const data = closes ?? [];
  const points = sparklinePoints(data, width, height);
  if (!points) return null;
  const trend = data[data.length - 1] - data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true" className={`shrink-0 ${changeColorClass(trend)}`}>
      <polyline points={points} fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
