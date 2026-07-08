"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

// LIFF 入口:在 LINE App 內開啟時初始化 LIFF,接著接上既有的 NextAuth LINE 登入,
// 完成後把使用者帶進看盤首頁。也能在一般瀏覽器中運作(退化為一般 LINE 登入)。
export default function LiffClient({ liffId }: { liffId: string | null }) {
  const router = useRouter();
  const { status } = useSession();
  // liff 初始化的結果:pending → 進行中;done → init 已嘗試(成功或失敗都算);
  // no-id → 尚未設定 LIFF_ID。
  const [liffState, setLiffState] = useState<"pending" | "done" | "no-id">(
    liffId ? "pending" : "no-id",
  );
  const handledRef = useRef(false);

  // 1) 初始化 LIFF(僅在瀏覽器端動態載入,避免 SSR 觸碰 window)
  useEffect(() => {
    if (!liffId) return;
    let cancelled = false;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
      } catch {
        // init 失敗(例如非 LINE 環境或 ID 設定問題)不阻擋流程,
        // 仍走一般 NextAuth 登入。
      } finally {
        if (!cancelled) setLiffState("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  // 2) LIFF 就緒 + session 已判定後,決定去向:已登入回首頁,未登入走 LINE 登入。
  useEffect(() => {
    if (liffState !== "done") return;
    if (status === "loading") return;
    if (handledRef.current) return;
    handledRef.current = true;
    if (status === "authenticated") {
      router.replace("/");
    } else {
      signIn("line", { callbackUrl: "/" });
    }
  }, [liffState, status, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">NazoDex 台股看板</h1>
      {liffState === "no-id" ? (
        <p className="max-w-sm text-sm text-gray-400">
          尚未設定 LIFF_ID。請在 LINE Developers 建立 LIFF app 後,把 LIFF ID 填入
          部署設定的 <code>LIFF_ID</code> 再重新部署。
        </p>
      ) : (
        <p className="text-sm text-gray-400">正在進入 NazoDex…</p>
      )}
    </main>
  );
}
