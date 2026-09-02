import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { clientIp, recordAuthEvent } from "@/lib/auth/audit";
import { sendOtpEmail } from "@/lib/auth/mail";
import { OtpCooldownError, issueOtp, OTP_TTL_MINUTES } from "@/lib/auth/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  purpose: z.enum(["signup", "login"]),
});

/**
 * Send a one-time code.
 *
 * The response never says whether the address has an account. For "login" that
 * would be an account-existence oracle — anyone could type addresses at this
 * endpoint and learn which of them are registered here, which is exactly the
 * list a credential-stuffer wants. So an unknown address gets the same shape
 * of reply as a known one, and simply never receives mail.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
    }
    const { email, purpose } = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });

    // Signing up with an address that already has a verified account is worth
    // saying out loud: it is not a secret to the person who owns the address,
    // and silence here leaves them waiting for mail that will never come.
    if (purpose === "signup" && existing?.emailVerifiedAt) {
      throw new BadRequestError("That email already has an account. Log in instead.");
    }

    const shouldSend = purpose === "signup" || Boolean(existing);

    if (shouldSend) {
      const { code } = await issueOtp(email, purpose);
      await sendOtpEmail({ to: email, code, purpose });
      await recordAuthEvent({
        email,
        event: "otp_sent",
        method: "otp",
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent"),
      });
    }

    return NextResponse.json({
      sent: true,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return routeError(err);
  }
}
