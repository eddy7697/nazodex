import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "@/auth.config";

// Full (Node.js runtime) instance: shares the edge-safe authConfig and adds the
// Prisma adapter (persists User/Account at sign-in) with JWT sessions so the
// middleware can validate sessions on the edge without touching the database.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
});
