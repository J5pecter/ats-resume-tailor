import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Who signed up, who signed in, and how — recorded locally and mirrored to a
 * spreadsheet when one is configured.
 *
 * What this deliberately does not record is the password. It cannot: passwords
 * are bcrypt hashes, which are one-way by construction, so there is nothing to
 * copy out. Making them copyable would mean storing them in plaintext, and a
 * spreadsheet is read by far more people, on far more laptops, than a database
 * is. The address, the moment and the method answer "who is using this",
 * which is the actual question.
 *
 * The sheet is reached through a Google Apps Script web app rather than the
 * Sheets API on purpose: a script bound to the sheet needs no service account,
 * no OAuth client, no key file and no npm dependency. It is a URL that accepts
 * a POST. Setup is in README under "Recording sign-ins".
 */

export type AuthEventName = "signup" | "login" | "otp_sent" | "otp_failed" | "verified";
export type AuthMethod = "password" | "otp" | "google";

export interface AuthEventInput {
  email: string;
  event: AuthEventName;
  method?: AuthMethod;
  ip?: string | null;
  userAgent?: string | null;
}

function webhookUrl(): string | null {
  const url = process.env.SHEETS_WEBHOOK_URL?.trim();
  return url && /^https:\/\//i.test(url) ? url : null;
}

export function sheetLoggingEnabled(): boolean {
  return webhookUrl() !== null;
}

/**
 * Record an event.
 *
 * Never throws. Auditing is an observer of the auth path, and an observer that
 * can fail a sign-in is worse than no observer — a spreadsheet being down must
 * not stop somebody logging in.
 */
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  let rowId: string | null = null;
  try {
    const row = await prisma.authEvent.create({
      data: {
        email,
        event: input.event,
        method: input.method ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    rowId = row.id;
  } catch {
    // The local row is the durable record; if even that fails there is nothing
    // useful left to do inside a request that is otherwise succeeding.
    return;
  }

  const url = webhookUrl();
  if (!url) return;

  try {
    // Short timeout: this sits inside a sign-in request, and a slow script
    // must not become a slow login.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: process.env.SHEETS_WEBHOOK_SECRET ?? "",
        timestamp: new Date().toISOString(),
        email,
        event: input.event,
        method: input.method ?? "",
        ip: input.ip ?? "",
        userAgent: input.userAgent ?? "",
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      await prisma.authEvent.update({ where: { id: rowId }, data: { exported: true } });
    }
  } catch {
    // Left with exported=false so it can be replayed later. The row is not
    // lost, only unmirrored.
  }
}

/** Best-effort client address, for the audit row. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}
