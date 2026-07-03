import type { NextAuthConfig } from "next-auth";
import Line from "next-auth/providers/line";

// Edge-safe Auth.js config: providers + callbacks only, NO database adapter and
// NO Prisma import. This is what the middleware uses so it can run in the Edge
// runtime (Prisma cannot). The full config (auth.ts) spreads this and adds the
// Prisma adapter for the Node.js runtime (route handlers, server components).
export default {
  providers: [Line],
  pages: { signIn: "/login" },
  callbacks: {
    // JWT sessions: the user id rides in the token (token.sub = user id set at
    // sign-in), so the session can be resolved without a DB lookup.
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
