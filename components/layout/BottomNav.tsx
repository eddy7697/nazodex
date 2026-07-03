"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "自選" },
  { href: "/market", label: "大盤" },
  { href: "/screener", label: "選股" },
  { href: "/strategy", label: "策略" },
  { href: "/holdings", label: "持股" },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-white/10 bg-[var(--card)] md:hidden">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`flex-1 py-3 text-center text-sm ${path === t.href ? "text-up font-bold" : "text-gray-400"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
