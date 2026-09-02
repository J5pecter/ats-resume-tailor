import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * One-time codes for proving an email address, and for signing in without a
 * password.
 *
 * The code is never stored. Only a SHA-256 of it is, for the same reason
 * passwords are hashed: this table is read by backups, support queries and
 * anyone who ever gets a copy of the database, and a plaintext code sitting in
 * it is a working credential for whoever reads it first.
 *
 * SHA-256 rather than bcrypt here on purpose. A code lives ten minutes, is
 * single-use, and is rate-limited to five attempts, so the offline-guessing
 * attack bcrypt defends against does not apply — and bcrypt's cost would be
 * paid on every verification of a code that is about to expire anyway.
 */

export type OtpPurpose = "signup" | "login";

/** Six digits: long enough given the attempt limit, short enough to retype. */
const CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

/** How often one address may request a code. Stops the app being a mail cannon. */
export const RESEND_COOLDOWN_SECONDS = 60;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * randomInt, not Math.random. The latter is seeded predictably enough that
 * codes could be guessed from each other, which would defeat the whole point.
 */
function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += String(randomInt(0, 10));
  return out;
}

/** Constant-time compare, so response timing cannot leak a partial match. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface IssuedOtp {
  code: string;
  expiresAt: Date;
}

export class OtpCooldownError extends Error {
  constructor(readonly secondsRemaining: number) {
    super(`Wait ${secondsRemaining} seconds before asking for another code.`);
  }
}

/**
 * Issue a code, invalidating any earlier one for the same address and purpose.
 *
 * Superseding rather than accumulating matters: two live codes means two
 * chances to guess, and a user who requested three codes should not find that
 * only the first still works.
 */
export async function issueOtp(email: string, purpose: OtpPurpose): Promise<IssuedOtp> {
  const address = email.trim().toLowerCase();

  const recent = await prisma.emailOtp.findFirst({
    where: { email: address, purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent) {
    const elapsed = (Date.now() - recent.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      throw new OtpCooldownError(Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
    }
  }

  await prisma.emailOtp.updateMany({
    where: { email: address, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  await prisma.emailOtp.create({
    data: { email: address, purpose, codeHash: hashCode(code), expiresAt },
  });

  return { code, expiresAt };
}

export type OtpFailure =
  | "no_code"
  | "expired"
  | "too_many_attempts"
  | "incorrect";

export type OtpResult = { ok: true } | { ok: false; reason: OtpFailure };

/**
 * Check a code and burn it.
 *
 * Every failure path increments the attempt counter, including a wrong code
 * for a live challenge — otherwise the limit is trivially bypassed by simply
 * guessing again.
 */
export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
): Promise<OtpResult> {
  const address = email.trim().toLowerCase();
  const supplied = code.replace(/\D/g, "");

  const row = await prisma.emailOtp.findFirst({
    where: { email: address, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, reason: "no_code" };

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.emailOtp.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.emailOtp.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!hashesMatch(hashCode(supplied), row.codeHash)) {
    await prisma.emailOtp.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "incorrect" };
  }

  await prisma.emailOtp.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { ok: true };
}

/** Human-facing reason. Deliberately vague about which code exists. */
export function otpFailureMessage(reason: OtpFailure): string {
  switch (reason) {
    case "no_code":
      return "That code has already been used, or none was requested. Ask for a new one.";
    case "expired":
      return `That code expired — they last ${OTP_TTL_MINUTES} minutes. Ask for a new one.`;
    case "too_many_attempts":
      return "Too many incorrect attempts. Ask for a new code.";
    case "incorrect":
      return "That code is not correct.";
  }
}
