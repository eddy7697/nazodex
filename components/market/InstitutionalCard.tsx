import type { InstitutionalFlow } from "@/lib/market-overview/types";
import { changeColorClass, fmtSignedYi } from "@/lib/format";

const ROWS = [
  { key: "foreign", label: "外資" },
  { key: "trust", label: "投信" },
  { key: "dealer", label: "自營商" },
] as const;

// 三大法人買賣超(億):買超紅、賣超綠
export default function InstitutionalCard({ flow }: { flow: InstitutionalFlow }) {
  return (
    <div>
      {ROWS.map((r) => {
        const v = flow[r.key];
        return (
          <div key={r.key} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
            <span className="text-sm">{r.label}</span>
            <span className={`font-bold ${changeColorClass(v)}`}>{fmtSignedYi(v)} 億</span>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-2 text-sm text-gray-400">
        <span>合計</span>
        <span className={changeColorClass(flow.total)}>{fmtSignedYi(flow.total)} 億</span>
      </div>
    </div>
  );
}
