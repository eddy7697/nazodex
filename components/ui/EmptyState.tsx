const VARIANTS = {
  watchlist: "/empty/watchlist.webp",
  holdings: "/empty/holdings.webp",
  screener: "/empty/screener.webp",
  closed: "/empty/market-closed.webp",
} as const;

// 空狀態:發光線條插圖(透明底)+ 置中文案。圖為裝飾性,語意由文案承擔(alt="")。
export default function EmptyState({
  variant, children,
}: { variant: keyof typeof VARIANTS; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <img src={VARIANTS[variant]} alt="" width={224} height={224} loading="lazy"
        className="h-56 w-56 object-contain" />
      <p className="text-gray-400">{children}</p>
    </div>
  );
}
