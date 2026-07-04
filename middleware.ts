import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Edge-safe middleware instance: built from authConfig WITHOUT the Prisma
// adapter, so no database access happens in the Edge runtime. JWT sessions let
// req.auth be resolved from the signed cookie alone.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  // /login and /liff are public entry points (the LIFF page runs its own
  // LINE sign-in flow, so it must not be gated by this middleware).
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/liff");
  if (!isLoggedIn && !isPublic) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  // 靜態素材(brand/empty/textures 與 icon.png)必須排除,否則未登入請求會被
  // 302 到 /login——登入頁自己的 Logo 與背景紋理就載不出來。注意 dev 的
  // Turbopack 不讓 public/ 檔案過 middleware,這問題只在 prod 出現;
  // 新增 public/ 子目錄或 metadata 圖檔時記得同步加進排除清單。
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon.png|brand/|empty/|textures/|login|liff).*)",
  ],
};
