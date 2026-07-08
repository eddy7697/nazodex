import type { Metadata } from "next";
import LiffClient from "@/components/liff/LiffClient";

export const metadata: Metadata = { title: "NazoDex — LINE 入口" };

// 於請求時讀取 LIFF_ID(來自部署環境變數 / configmap),而非 build 時固定,
// 因此設定 LIFF_ID 後只需重新部署、不必重 build image。
export const dynamic = "force-dynamic";

export default function LiffPage() {
  const liffId = process.env.LIFF_ID ?? null;
  return <LiffClient liffId={liffId} />;
}
