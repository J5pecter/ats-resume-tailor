import "server-only";

import type { ZodType } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonLoose } from "./json";
import {
  callEndpoint,
  LlmCallError,
  LlmConfigError,
  LlmRateLimitError,
  LlmTruncatedError,
} from "./providers";
import {
  describeEndpoint,
  resolveChain,
  type LlmEndpoint,
  type ResolvedChain,
} from "./endpoints";

export { LlmCallError, LlmConfigError, LlmRateLimitError };

/** Per model call, as required by §5.0. Rate-limit waiting sits outside it. */
const TIMEOUT_MS = 60_000;

/**
 * Free tiers meter by the minute, so a normal run of the pipeline will trip the
 * limit partway through. A short wait is nearly always enough, and is a far
 * better experience than failing a generation the user has already waited on.
 * Anything longer is reported instead of silently stalling.
 */
const MAX_RATE_LIMIT_WAIT_S = 45;
const MAX_TOTAL_RATE_LIMIT_WAIT_S = 90;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LlmValidationError extends Error {
  constructor(
    message: string,
    readonly promptName: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

export interface StructuredCallOptions<T> {
  promptName: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  /** 0.2 for parsing/analysis, 0.4 for tailoring/refinement (§5.0). */
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  userId?: string;
}

export interface StructuredCallResult<T> {
  data: T;
  raw: string;
  meta: {
    promptName: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    attempts: number;
    validationPassed: boolean;
  };
}

/**
 * The single entry point for every LLM call in the app (§5.0, §5.7).
 *
 *   call -> strip fences -> JSON.parse -> Zod.safeParse
 *        -> on failure, ONE retry with the validation error appended
 *        -> on second failure, a clean error for the user
 *
 * Nothing unvalidated ever leaves this function. Logging records call
 * metadata only — never resume or job-description content.
 */
export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  const chain = resolveChain();
  if (chain.endpoints.length === 0) throw new LlmConfigError(noUsableEndpoint(chain));

  // Which endpoint answered is not known until one does. Seeded with the
  // primary so a failure before the first response still logs something true.
  let served: LlmEndpoint = chain.endpoints[0];
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 4096;
  const thinking = opts.thinking ?? false;

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let lastProblem = "";
  let user = opts.user;

  try {
    for (attempts = 1; attempts <= 2; attempts++) {
      const attempt = await callAcrossChain(chain, {
        system: opts.system,
        user,
        maxTokens,
        temperature,
        thinking,
      });
      const res = attempt.res;
      served = attempt.endpoint;
      const raw = res.text;
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;

      let parsed: unknown;
      try {
        parsed = parseJsonLoose(raw);
      } catch (err) {
        lastProblem = `Output was not valid JSON: ${(err as Error).message}`;
        user = retryTurn(opts.user, lastProblem);
        continue;
      }

      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        await logCall(opts.userId, {
          promptName: opts.promptName,
          provider: served.provider,
          model: served.model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          attempts,
          ok: true,
        });
        return {
          data: result.data,
          raw,
          meta: {
            promptName: opts.promptName,
            provider: served.provider,
            model: served.model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - started,
            attempts,
            validationPassed: true,
          },
        };
      }

      lastProblem = summariseZodIssues(result.error.issues);
      user = retryTurn(opts.user, lastProblem);
    }

    throw new LlmValidationError(
      "The model returned a response that did not match the expected structure, twice in a row. Please try again.",
      opts.promptName,
      lastProblem,
    );
  } catch (err) {
    await logCall(opts.userId, {
      promptName: opts.promptName,
      provider: served.provider,
      model: served.model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      attempts,
      ok: false,
    });
    throw err;
  }
}

/** Spec-named alias. Kept so §5.6's `callClaude()` reference resolves. */
export const callClaude = callStructured;

/**
 * One provider call, with its own 60s timeout, retried only when the provider
 * says it is momentarily out of budget.
 *
 * The wait deliberately sits outside the timeout: a rate-limit pause is not the
 * model being slow, and charging it against the response deadline would turn a
 * recoverable stall into a failure.
 */
async function callOnce(
  e: LlmEndpoint,
  req: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    thinking: boolean;
  },
) {
  let waitedSeconds = 0;
  let maxTokens = req.maxTokens;
  let grownOnce = false;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      return await callEndpoint(e, { ...req, maxTokens, signal: controller.signal });
    } catch (err) {
      if (err instanceof LlmConfigError) throw err;

      // Reservations are deliberately tight so that more calls fit inside a
      // metered window. When a document turns out to be bigger than the
      // reservation allowed for, grow it once rather than failing the user.
      if (err instanceof LlmTruncatedError) {
        const grown = Math.min(Math.round(err.reservedTokens * 1.9), err.headroomTokens);
        if (grownOnce || grown <= err.reservedTokens) {
          throw new LlmCallError(
            `The reply was cut off before it was complete, even after raising the limit to ${err.reservedTokens.toLocaleString()} tokens. This resume is too long for the current provider tier — shorten it, or move to a higher tier.`,
          );
        }
        grownOnce = true;
        maxTokens = grown;
        console.info(`[llm] truncated, retrying with ${grown} completion tokens`);
        continue;
      }

      if (err instanceof LlmRateLimitError) {
        const wait = err.retryAfterSeconds;
        if (
          wait > MAX_RATE_LIMIT_WAIT_S ||
          waitedSeconds + wait > MAX_TOTAL_RATE_LIMIT_WAIT_S
        ) {
          throw new LlmRateLimitError(
            `The provider's per-minute token budget is exhausted. Wait about ${wait} seconds and try again.`,
            wait,
          );
        }
        waitedSeconds += wait;
        console.info(`[llm] rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }

      if (controller.signal.aborted) {
        throw new LlmCallError(
          `The model did not respond within ${TIMEOUT_MS / 1000}s. Try again.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Try each endpoint in turn until one answers.
 *
 * Everything that reaches here has already exhausted the per-endpoint recovery
 * in `callOnce` — the rate-limit wait and the one-off reservation growth. So a
 * failure at this level means that endpoint is not going to serve this request,
 * and the only question left is whether another one might.
 *
 * The answer is nearly always yes, because the failures a free tier actually
 * produces are all endpoint-specific: a revoked key, a suspended account, a
 * per-minute budget that belongs to that provider, a request too large for that
 * tier, an outage at that host. None of them say anything about the request
 * itself. So any error moves to the next endpoint rather than being classified
 * — a wrong guess here costs one wasted call, while being too clever costs the
 * outage this exists to prevent.
 *
 * With a single endpoint configured, the original error is rethrown untouched:
 * a chain of one must behave exactly as it did before there were chains.
 */
async function callAcrossChain(
  chain: ResolvedChain,
  req: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    thinking: boolean;
  },
): Promise<{ res: Awaited<ReturnType<typeof callOnce>>; endpoint: LlmEndpoint }> {
  const failures: { endpoint: LlmEndpoint; error: unknown }[] = [];

  for (const [index, endpoint] of chain.endpoints.entries()) {
    try {
      const res = await callOnce(endpoint, req);
      if (index > 0) {
        console.info(`[llm] served by fallback ${describeEndpoint(endpoint)}`);
      }
      return { res, endpoint };
    } catch (err) {
      failures.push({ endpoint, error: err });
      const remaining = chain.endpoints.length - index - 1;
      if (remaining > 0) {
        console.warn(
          `[llm] ${describeEndpoint(endpoint)} failed (${(err as Error).message}); ` +
            `falling back, ${remaining} endpoint(s) left`,
        );
      }
    }
  }

  throw chainFailure(failures);
}

/**
 * Collapse a whole failed chain into one error.
 *
 * The class is load-bearing, not decorative: `routeError` maps it to the HTTP
 * status, so flattening everything into a generic call error would turn a
 * recoverable 429 into something the UI reports as broken. When every endpoint
 * ran out of budget, that is still a rate limit and is re-thrown as one.
 */
function chainFailure(failures: { endpoint: LlmEndpoint; error: unknown }[]): unknown {
  if (failures.length === 1) return failures[0].error;

  const rateLimits = failures.filter((f) => f.error instanceof LlmRateLimitError);
  if (rateLimits.length === failures.length) {
    const worst = rateLimits
      .map((f) => f.error as LlmRateLimitError)
      .reduce((a, b) => (a.retryAfterSeconds <= b.retryAfterSeconds ? a : b));
    return new LlmRateLimitError(
      `Every configured model endpoint is out of budget. The soonest is ready in about ${worst.retryAfterSeconds} seconds.`,
      worst.retryAfterSeconds,
    );
  }

  const detail = failures
    .map((f) => `${describeEndpoint(f.endpoint)} — ${(f.error as Error).message}`)
    .join("; ");
  return new LlmCallError(`All ${failures.length} model endpoints failed. ${detail}`);
}

/** Setup guidance when the chain resolved to nothing usable. */
function noUsableEndpoint(chain: ResolvedChain): string {
  if (chain.skipped.length === 0) {
    return "No model endpoint is configured. Set LLM_PROVIDER and its API key in .env.local.";
  }
  const reasons = chain.skipped
    .map((s) => `${describeEndpoint(s.endpoint)} — ${s.reason}`)
    .join("; ");
  return `No usable model endpoint. ${reasons}`;
}

function retryTurn(originalUser: string, problem: string): string {
  return `${originalUser}\n\nYour previous output failed validation: ${problem}\nReturn corrected JSON only.`;
}

function summariseZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

interface CallLog {
  promptName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  ok: boolean;
}

async function logCall(userId: string | undefined, log: CallLog): Promise<void> {
  // Metadata only. Resume and JD content never reaches this table (§7 Privacy).
  if (process.env.NODE_ENV !== "test") {
    console.info(`[llm] ${JSON.stringify({ ...log, validationPassed: log.ok })}`);
  }
  if (!userId) return;
  try {
    await prisma.llmCall.create({ data: { userId, ...log } });
  } catch {
    // Observability must never break the request path.
  }
}
