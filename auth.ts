import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  // Database sessions: the session cookie is an opaque token, and the user id
  // is resolved server-side from the Session table on every request.
  session: { strategy: "database" },
  callbacks: {
    // The default callback strips the id; we need it to scope every query.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
