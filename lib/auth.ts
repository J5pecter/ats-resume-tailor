import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signupCodeMatches, signupCodeRequired } from "@/lib/signupGate";

/**
 * NextAuth v5, JWT sessions (§2).
 *
 * Two ways in:
 *   - Credentials: email + password, bcrypt cost 12. Always available.
 *   - Google: enabled only when AUTH_GOOGLE_ID/SECRET are present, so the app
 *     runs with zero external setup and gains the button when you add a key.
 *
 * No database adapter: sessions are JWTs and the Google flow upserts into our
 * own User table, which keeps the schema exactly as specified in §3.
 */

export { signupCodeMatches, signupCodeRequired };

export const BCRYPT_COST = 12;

/** The Google button appears only when a client is configured for it. */
export function googleEnabled(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim());
}

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const SignUpSchema = CredentialsSchema.extend({
  fullName: z.string().trim().min(1, "Enter your name.").max(120),
  /** Only checked when SIGNUP_CODE is set — see signupCodeRequired(). */
  signupCode: z.string().optional(),
});

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = CredentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      // An account created through Google has no usable password hash.
      if (!user || !user.passwordHash) return null;

      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!ok) return null;

      return { id: user.id, email: user.email, name: user.fullName ?? undefined };
    },
  }),
];

if (googleEnabled()) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/", error: "/" },
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;

      // Google-authenticated accounts carry an empty passwordHash, which the
      // credentials provider treats as "no password login for this account".
      const record = await prisma.user.upsert({
        where: { email },
        update: { fullName: user.name ?? undefined },
        create: { email, fullName: user.name ?? null, passwordHash: "" },
      });
      user.id = record.id;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        return token;
      }
      // Resolve the id on first refresh if a provider skipped signIn's assignment.
      if (!token.uid && token.email) {
        const record = await prisma.user.findUnique({
          where: { email: token.email.toLowerCase() },
          select: { id: true },
        });
        if (record) token.uid = record.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Session guard for route handlers and server components. Returns the user id. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new UnauthorizedError();
  return id;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("You need to be signed in to do that.");
  }
}
