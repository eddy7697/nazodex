import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Taidex 台股看板", description: "台股自選股看盤" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
