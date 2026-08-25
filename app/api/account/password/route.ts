import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { BCRYPT_COST, requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  /** Omitted only by accounts created through Google, which have no password yet. */
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "Your new password must be at least 8 characters."),
});

/**
 * Change (or, for a Google-created account, first set) the account password.
 *
 * Deliberately self-service: a password the user has not chosen themselves is
 * one somebody else has seen.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new BadRequestError("That account no longer exists.");

    const hasPassword = Boolean(user.passwordHash);

    // An account that already has a password must prove ownership of it, so a
    // borrowed session cannot lock the real owner out.
    if (hasPassword) {
      const current = parsed.data.currentPassword ?? "";
      if (!current) throw new BadRequestError("Enter your current password.");
      const ok = await bcrypt.compare(current, user.passwordHash);
      if (!ok) throw new BadRequestError("That current password is not correct.");

      if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
        throw new BadRequestError("That is already your password. Choose a different one.");
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST) },
    });

    return NextResponse.json({ changed: true, wasFirstPassword: !hasPassword });
  } catch (err) {
    return routeError(err);
  }
}
