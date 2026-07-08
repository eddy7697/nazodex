import "./globals.css";
import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
export const metadata: Metadata = { title: "NazoDex 台股看板", description: "台股自選股看盤" };
// 看盤點擊頻繁,禁止雙擊/兩指縮放(iOS Safari 會忽略 meta,靠 globals.css 的 touch-action 補)。
// viewportFit cover:讓頁面延伸進 iPhone 底部 Home Indicator 的 safe area——
// 否則 LINE LIFF 的 WKWebView 會在最底下露出白色底(Safari 會延伸背景色所以看不出來)。
// 配套:BottomNav 需墊 env(safe-area-inset-bottom),見 BottomNav.tsx。
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
