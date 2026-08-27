import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { BadRequestError, routeError } from "@/lib/api";
import { BCRYPT_COST, SignUpSchema } from "@/lib/auth";
import { signupCodeMatches } from "@/lib/signupGate";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const parsed = SignUpSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    }
    const { email, password, fullName, signupCode } = parsed.data;

    // Checked before the account exists, so a wrong code leaves nothing behind.
    if (!signupCodeMatches(signupCode)) {
      throw new BadRequestError("That signup code is not correct.");
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new BadRequestError("An account with that email already exists. Log in instead.");
    }

    await prisma.user.create({
      data: { email, fullName, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return routeError(err);
  }
}
