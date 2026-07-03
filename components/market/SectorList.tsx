import type { SectorChange } from "@/lib/market-overview/types";
import { changeColorClass, fmtSignedPct } from "@/lib/format";

function Column({ title, items }: { title: string; items: SectorChange[] }) {
  return (
    <div className="flex-1">
      <div className="mb-1 text-xs text-gray-400">{title}</div>
      {items.map((s) => (
        <div key={s.name} className="flex items-center justify-between py-1 text-sm">
          <span>{s.name}</span>
          <span className={`font-bold ${changeColorClass(s.changePct)}`}>{fmtSignedPct(s.changePct)}</span>
        </div>
      ))}
    </div>
  );
}

// 最強 / 最弱各 5 個類股(已依漲跌幅排序)
export default function SectorList({ sectors }: { sectors: SectorChange[] }) {
  const strongest = sectors.slice(0, 5);
  const weakest = sectors.slice(-5).reverse();
  return (
    <div className="flex gap-6">
      <Column title="最強" items={strongest} />
      <Column title="最弱" items={weakest} />
    </div>
  );
}
