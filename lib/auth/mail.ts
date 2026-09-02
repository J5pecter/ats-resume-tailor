import "server-only";

import { OTP_TTL_MINUTES } from "./otp";

/**
 * Sending the code.
 *
 * Two sinks, chosen by whether SMTP is configured:
 *
 *   - SMTP, when SMTP_HOST and friends are set. Works with anything that
 *     speaks it — a Gmail app password, Resend, Mailtrap, a company relay —
 *     which keeps the app from being married to one vendor's SDK.
 *   - The server log, when it is not. The app then runs with no external
 *     account at all: sign-up still works, the code just appears in the
 *     terminal instead of an inbox.
 *
 * The fallback is a real feature, not a stub. It is what lets a fresh checkout
 * work offline and what lets the test accounts below be created without a mail
 * provider. It is also obviously wrong for production, so it says so loudly
 * every time it fires.
 */

export interface OtpEmail {
  to: string;
  code: string;
  purpose: "signup" | "login";
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim());
}

export function mailTransportName(): "smtp" | "console" {
  return smtpConfigured() ? "smtp" : "console";
}

function subjectFor(purpose: OtpEmail["purpose"]): string {
  return purpose === "signup"
    ? "Confirm your email for ATS Resume Tailor"
    : "Your sign-in code for ATS Resume Tailor";
}

function bodyFor(email: OtpEmail): { text: string; html: string } {
  const line =
    email.purpose === "signup"
      ? "Use this code to confirm your email address:"
      : "Use this code to sign in:";

  const text = [
    line,
    "",
    email.code,
    "",
    `It expires in ${OTP_TTL_MINUTES} minutes and can be used once.`,
    "If you did not ask for this, you can ignore it — nothing has been created or changed.",
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p>${line}</p>
  <p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:20px 0">${email.code}</p>
  <p>It expires in ${OTP_TTL_MINUTES} minutes and can be used once.</p>
  <p style="color:#555">If you did not ask for this, you can ignore it — nothing has been created or changed.</p>
</div>`;

  return { text, html };
}

export async function sendOtpEmail(email: OtpEmail): Promise<void> {
  const { text, html } = bodyFor(email);

  if (!smtpConfigured()) {
    // Deliberately loud. A code printed to a log is fine on a laptop and a
    // security incident on a server, so it should never be mistaken for
    // working email.
    console.warn(
      [
        "",
        "  ┌───────────────────────────────────────────────────────────────┐",
        "  │  NO SMTP CONFIGURED — the code below was NOT emailed.         │",
        "  │  Set SMTP_HOST/SMTP_USER/SMTP_PASS to send it for real.       │",
        "  └───────────────────────────────────────────────────────────────┘",
        `  to      : ${email.to}`,
        `  purpose : ${email.purpose}`,
        `  code    : ${email.code}`,
        `  expires : ${OTP_TTL_MINUTES} minutes`,
        "",
      ].join("\n"),
    );
    return;
  }

  // Imported here rather than at module load: the console path must not need
  // the dependency resolved at all.
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT ?? 587);

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    // produces a hang rather than an error, which is a miserable thing to debug.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER,
    to: email.to,
    subject: subjectFor(email.purpose),
    text,
    html,
  });
}
