"use client";
import Link from "next/link";
import { changeColorClass, fmtPrice, fmtSignedPct } from "@/lib/format";
import type { NumericField, ScreenerRow } from "@/lib/screener/types";
import EmptyState from "@/components/ui/EmptyState";

const LIMIT = 100;
const COLS: { field: NumericField; label: string }[] = [
  { field: "close", label: "現價" },
  { field: "changePct", label: "漲跌%" },
  { field: "dividendYield", label: "殖利率" },
  { field: "peRatio", label: "本益比" },
  { field: "volumeLots", label: "張數" },
];

const dash = (v: number | null, fmt: (n: number) => string) => (v == null ? "—" : fmt(v));

function AddButton({
  symbol, watched, onAdd,
}: { symbol: string; watched: Set<string>; onAdd: (symbol: string) => void }) {
  const added = watched.has(symbol);
  return (
    <button
      disabled={added}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd(symbol); }}
      className={`rounded px-2 py-1 text-xs ${added ? "text-gray-500" : "bg-white/5 text-gray-300"}`}
      aria-label={added ? "已在自選" : "加入自選"}
    >
      {added ? "✓ 已加" : "＋自選"}
    </button>
  );
}

export default function ResultList({
  rows, sort, onSort, watched, onAdd,
}: {
  rows: ScreenerRow[];
  sort: { field: NumericField; dir: "asc" | "desc" };
  onSort: (s: { field: NumericField; dir: "asc" | "desc" }) => void;
  watched: Set<string>;
  onAdd: (symbol: string) => void;
}) {
  const shown = rows.slice(0, LIMIT);
  function clickSort(field: NumericField) {
    onSort(sort.field === field ? { field, dir: sort.dir === "desc" ? "asc" : "desc" } : { field, dir: "desc" });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          符合 {rows.length} 檔{rows.length > LIMIT ? `(僅列前 ${LIMIT})` : ""}
        </p>
        {/* 手機:排序選單(桌機用表頭排序) */}
        <select
          value={sort.field}
          onChange={(e) => onSort({ field: e.target.value as NumericField, dir: "desc" })}
          className="rounded bg-[var(--card)] px-2 py-1 text-xs text-gray-300 md:hidden"
          aria-label="排序"
        >
          {COLS.map((c) => <option key={c.field} value={c.field}>{c.label}排序</option>)}
        </select>
      </div>

      {rows.length === 0 && <EmptyState variant="screener">沒有符合條件的股票,放寬條件再找找。</EmptyState>}

      {/* 手機:卡片 */}
      <div className="space-y-2 md:hidden">
        {shown.map((r) => {
          const c = changeColorClass(r.changePct ?? 0);
          return (
            <Link key={r.symbol} href={`/stock/${r.symbol}`}
              className="flex items-center justify-between rounded-lg bg-[var(--card)] p-4">
              <div>
                <div className="font-bold">{r.name}</div>
                <div className="text-xs text-gray-400">{r.symbol}・{r.volumeLots.toLocaleString()} 張</div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${c}`}>{fmtPrice(r.close)}</div>
                <div className={`text-sm ${c}`}>{dash(r.changePct, fmtSignedPct)}</div>
                <div className="text-xs text-gray-400">
                  殖 {dash(r.dividendYield, (n) => `${n.toFixed(2)}%`)}・PE {dash(r.peRatio, (n) => n.toFixed(2))}
                </div>
              </div>
              <div className="ml-3"><AddButton symbol={r.symbol} watched={watched} onAdd={onAdd} /></div>
            </Link>
          );
        })}
      </div>

      {/* 桌機:表格 */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-white/10 text-left text-gray-400">
            <th className="py-2">名稱</th>
            {COLS.map((col) => (
              <th key={col.field} className="cursor-pointer py-2 text-right" onClick={() => clickSort(col.field)}>
                {col.label}{sort.field === col.field ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const c = changeColorClass(r.changePct ?? 0);
            return (
              <tr key={r.symbol} className="border-b border-white/5">
                <td className="py-2">
                  <Link href={`/stock/${r.symbol}`}>{r.name}<span className="ml-2 text-xs text-gray-400">{r.symbol}</span></Link>
                </td>
                <td className={`py-2 text-right font-bold ${c}`}>{fmtPrice(r.close)}</td>
                <td className={`py-2 text-right ${c}`}>{dash(r.changePct, fmtSignedPct)}</td>
                <td className="py-2 text-right">{dash(r.dividendYield, (n) => `${n.toFixed(2)}%`)}</td>
                <td className="py-2 text-right">{dash(r.peRatio, (n) => n.toFixed(2))}</td>
                <td className="py-2 text-right text-gray-400">{r.volumeLots.toLocaleString()}</td>
                <td className="py-2 pl-3 text-right"><AddButton symbol={r.symbol} watched={watched} onAdd={onAdd} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
