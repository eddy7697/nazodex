import type { EpsPoint, RevenuePoint } from "@/lib/fundamentals/service";
import { fmtSignedPct, changeColorClass } from "@/lib/format";

export default function FundamentalsSection({ revenues, eps }: { revenues: RevenuePoint[]; eps: EpsPoint[] }) {
  if (revenues.length === 0 && eps.length === 0) return null;
  const latest = revenues[revenues.length - 1];
  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">基本面</h2>
      {revenues.length > 0 && (
        <div className="rounded-lg bg-[var(--card)] p-4">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-gray-400">月營收({latest.month})</span>
            <span>
              {latest.revenueBillions >= 10 ? latest.revenueBillions.toFixed(0) : latest.revenueBillions.toFixed(2)} 億
              {latest.yoyPct != null && (
                <span className={`ml-2 text-xs ${changeColorClass(latest.yoyPct)}`}>
                  年增 {fmtSignedPct(latest.yoyPct)}
                </span>
              )}
            </span>
          </div>
          <div className="flex h-16 items-end gap-1" aria-label="近 12 月營收長條圖">
            {revenues.map((p) => (
              <div key={p.month} className="flex-1" title={`${p.month}:${p.revenueBillions.toFixed(1)} 億`}>
                <div className="w-full rounded-t bg-brand opacity-70" style={{ height: `${Math.max(p.barPct, 2)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>{revenues[0].month}</span>
            <span>{latest.month}</span>
          </div>
        </div>
      )}
      {eps.length > 0 && (
        <div className="rounded-lg bg-[var(--card)] p-4 text-sm">
          <div className="mb-2 text-gray-400">每股盈餘 EPS(元)</div>
          <div className="grid grid-cols-4 gap-2">
            {eps.map((q) => (
              <div key={q.label} className="text-center">
                <div className="text-xs text-gray-500">{q.label}</div>
                <div className={q.eps < 0 ? "text-down" : ""}>{q.eps.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
