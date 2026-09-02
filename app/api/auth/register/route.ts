import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { BadRequestError, routeError } from "@/lib/api";
import { BCRYPT_COST, SignUpSchema } from "@/lib/auth";
import { clientIp, recordAuthEvent } from "@/lib/auth/audit";
import { otpFailureMessage, verifyOtp } from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Create an account, once the address has been proven.
 *
 * Signup is open to anyone — there is no invite code. What stands in its place
 * is the emailed code: an account cannot exist until somebody has demonstrated
 * they can read mail at the address they typed. That is a better gate than a
 * shared secret was, because a shared secret protects the instance exactly
 * until the first person passes it along.
 *
 * The account row is written only after the code checks out, so a wrong code
 * leaves nothing behind and a half-finished signup cannot squat an address.
 */
export async function POST(req: Request) {
  try {
    const parsed = SignUpSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    }
    const { email, password, fullName, code } = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (existing?.emailVerifiedAt) {
      throw new BadRequestError("An account with that email already exists. Log in instead.");
    }

    const result = await verifyOtp(email, "signup", code);
    if (!result.ok) {
      await recordAuthEvent({
        email,
        event: "otp_failed",
        method: "otp",
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent"),
      });
      throw new BadRequestError(otpFailureMessage(result.reason));
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const now = new Date();

    // Upsert rather than create: an unverified row for this address may exist
    // from an abandoned attempt, and that must not block the real one.
    await prisma.user.upsert({
      where: { email },
      update: { fullName, passwordHash, emailVerifiedAt: now },
      create: { email, fullName, passwordHash, emailVerifiedAt: now },
    });

    await recordAuthEvent({
      email,
      event: "signup",
      method: "password",
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return routeError(err);
  }
}
