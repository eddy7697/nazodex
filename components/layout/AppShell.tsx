import BottomNav from "@/components/layout/BottomNav";
import SignOutButton from "@/components/SignOutButton";

export default function AppShell({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl pb-16 md:pb-0">
      <header className="relative flex items-center justify-between overflow-hidden border-b border-white/10 px-4 py-3">
        {/* 稜線裝飾:鏡像後光在右側,遠離左側標題 */}
        <img src="/textures/header.webp" alt="" aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 -scale-x-100 object-cover opacity-60" />
        <div className="relative flex items-center gap-2">
          <img src="/brand/logo.webp" alt="" width={24} height={24} className="h-6 w-6" />
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
        <div className="relative"><SignOutButton /></div>
      </header>
      <main className="p-4">{children}</main>
      <BottomNav />
    </div>
  );
}
