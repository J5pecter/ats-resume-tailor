import "server-only";

import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";
import { ExtractionError } from "@/lib/extract/text";
import {
  LlmCallError,
  LlmConfigError,
  LlmRateLimitError,
  LlmValidationError,
} from "@/lib/llm/client";
import { RateLimitError } from "@/lib/rateLimit";

export class NotFoundError extends Error {
  constructor(what = "That record") {
    super(`${what} was not found, or does not belong to your account.`);
  }
}

export class BadRequestError extends Error {}

/**
 * Maps domain errors to HTTP responses with messages a user can act on.
 * Unknown errors are logged server-side and reported generically — resume and
 * JD content must never leak into a client-visible error (§7 Privacy).
 */
export function routeError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: err.message }, { status: 429 });
  }
  if (err instanceof BadRequestError || err instanceof ExtractionError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof LlmRateLimitError) {
    return NextResponse.json(
      { error: err.message, retryAfterSeconds: err.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } },
    );
  }
  if (err instanceof LlmConfigError) {
    return NextResponse.json({ error: err.message, kind: "config" }, { status: 503 });
  }
  if (err instanceof LlmValidationError || err instanceof LlmCallError) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  console.error("[route] unhandled error:", err instanceof Error ? err.stack : err);
  return NextResponse.json(
    { error: "Something went wrong on our side. Please try again." },
    { status: 500 },
  );
}
