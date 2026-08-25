import "server-only";

import { prisma } from "@/lib/prisma";

/** 20 generations per user per hour by default (§7 Security). */
export class RateLimitError extends Error {
  constructor(readonly retryAfterMinutes: number, limit: number) {
    super(
      `You've used all ${limit} generations for this hour. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`,
    );
  }
}

const GENERATIVE_PROMPTS = ["TAILOR_ENGINE", "REFINE_ENGINE"];

export function generationLimit(): number {
  const n = Number(process.env.RATE_LIMIT_GENERATIONS_PER_HOUR ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export async function assertWithinRateLimit(userId: string): Promise<void> {
  const limit = generationLimit();
  const since = new Date(Date.now() - 60 * 60 * 1000);

  const calls = await prisma.llmCall.findMany({
    where: { userId, promptName: { in: GENERATIVE_PROMPTS }, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (calls.length < limit) return;

  const oldest = calls[0].createdAt.getTime();
  const freesUpAt = oldest + 60 * 60 * 1000;
  const minutes = Math.max(1, Math.ceil((freesUpAt - Date.now()) / 60_000));
  throw new RateLimitError(minutes, limit);
}

export async function generationsRemaining(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const used = await prisma.llmCall.count({
    where: { userId, promptName: { in: GENERATIVE_PROMPTS }, createdAt: { gte: since } },
  });
  return Math.max(0, generationLimit() - used);
}
