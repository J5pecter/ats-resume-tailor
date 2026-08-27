import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * What happens when a free tier stops being free — or just stops.
 *
 * These drive the real `callStructured`, with only the network boundary
 * replaced, so the failover path they exercise is the one requests take.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: { llmCall: { create: vi.fn(async () => undefined) } },
}));

const callEndpoint = vi.fn();

vi.mock("@/lib/llm/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers")>();
  return { ...actual, callEndpoint };
});

const { callStructured } = await import("@/lib/llm/client");
const { LlmCallError, LlmConfigError, LlmRateLimitError } = await import(
  "@/lib/llm/providers"
);

const Schema = z.object({ ok: z.boolean() });

function answer(model: string) {
  return {
    text: JSON.stringify({ ok: true }),
    inputTokens: 10,
    outputTokens: 5,
    model,
  };
}

const call = () =>
  callStructured({
    promptName: "TEST",
    system: "s",
    user: "u",
    schema: Schema,
  });

const saved = { ...process.env };

beforeEach(() => {
  callEndpoint.mockReset();
  for (const key of Object.keys(process.env)) {
    if (/^(LLM_|OPENAI_COMPATIBLE_|ANTHROPIC_|GOOGLE_|GEMINI_|ALLOW_PAID)/.test(key)) {
      delete process.env[key];
    }
  }
  process.env.OPENAI_COMPATIBLE_API_KEY = "primary-key";
});
afterEach(() => {
  process.env = { ...saved };
});

/** Primary + one spare, both on the OpenAI-compatible adapter. */
function withSpare() {
  process.env.LLM_FALLBACKS = "spare";
  process.env.LLM_SPARE_API_KEY = "spare-key";
  process.env.LLM_SPARE_MODEL = "spare-model";
}

describe("failover", () => {
  it("does not touch the spare while the primary is healthy", async () => {
    withSpare();
    callEndpoint.mockResolvedValueOnce(answer("primary-model"));

    const res = await call();
    expect(res.data).toEqual({ ok: true });
    expect(callEndpoint).toHaveBeenCalledTimes(1);
    expect(callEndpoint.mock.calls[0][0].name).toBe("primary");
  });

  it("moves to the spare when the primary's key is rejected", async () => {
    withSpare();
    callEndpoint
      .mockRejectedValueOnce(new LlmCallError("... returned 401. invalid api key"))
      .mockResolvedValueOnce(answer("spare-model"));

    const res = await call();
    expect(res.data).toEqual({ ok: true });
    expect(callEndpoint).toHaveBeenCalledTimes(2);
    expect(callEndpoint.mock.calls[1][0].name).toBe("spare");
  });

  it("reports the endpoint that actually answered, not the one that was asked first", async () => {
    withSpare();
    callEndpoint
      .mockRejectedValueOnce(new LlmCallError("host is down"))
      .mockResolvedValueOnce(answer("spare-model"));

    const res = await call();
    expect(res.meta.model).toBe("spare-model");
  });

  it("moves on when the request is too large for the primary's tier", async () => {
    withSpare();
    // A local spare has no per-minute ceiling, so this genuinely can succeed
    // where the metered primary cannot.
    callEndpoint
      .mockRejectedValueOnce(new LlmCallError("This request is too large for the 8,000-tokens-per-minute limit."))
      .mockResolvedValueOnce(answer("spare-model"));

    await expect(call()).resolves.toMatchObject({ data: { ok: true } });
    expect(callEndpoint).toHaveBeenCalledTimes(2);
  });

  it("keeps the rate-limit type when every endpoint is out of budget", async () => {
    withSpare();
    // Both waits are deliberately past the 45s the client is willing to sit
    // through, so it declines to wait and the failover path runs immediately.
    // A shorter wait would be slept off for real and the test would take a
    // minute to assert nothing extra.
    callEndpoint
      .mockRejectedValueOnce(new LlmRateLimitError("primary spent", 60))
      .mockRejectedValueOnce(new LlmRateLimitError("spare spent", 50));

    // The class drives the HTTP status, so collapsing this into a generic
    // failure would report a recoverable pause as a broken app.
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmRateLimitError);
    // Advertise the soonest one to come back, not the worst.
    expect(err.retryAfterSeconds).toBe(50);
  });

  it("summarises a mixed set of failures, naming each endpoint", async () => {
    withSpare();
    callEndpoint
      .mockRejectedValueOnce(new LlmCallError("401 invalid api key"))
      .mockRejectedValueOnce(new LlmCallError("503 upstream unavailable"));

    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmCallError);
    expect(err.message).toMatch(/All 2 model endpoints failed/);
    expect(err.message).toMatch(/primary/);
    expect(err.message).toMatch(/spare/);
    expect(err.message).toMatch(/401 invalid api key/);
    expect(err.message).toMatch(/503 upstream unavailable/);
  });

  it("rethrows untouched when only one endpoint is configured", async () => {
    const original = new LlmCallError("the one and only failure");
    callEndpoint.mockRejectedValueOnce(original);

    // A chain of one must behave exactly as it did before chains existed.
    await expect(call()).rejects.toBe(original);
  });

  it("explains itself when nothing usable is configured at all", async () => {
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    await expect(call()).rejects.toThrow(LlmConfigError);
    expect(callEndpoint).not.toHaveBeenCalled();
  });

  it("skips a metered spare rather than spending on it", async () => {
    process.env.LLM_FALLBACKS = "claude";
    process.env.LLM_CLAUDE_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-key";
    const original = new LlmCallError("primary is down");
    callEndpoint.mockRejectedValueOnce(original);

    // An outage must not be the thing that starts a bill.
    await expect(call()).rejects.toBe(original);
    expect(callEndpoint).toHaveBeenCalledTimes(1);
  });

  it("uses a metered spare only once opted into out loud", async () => {
    process.env.ALLOW_PAID_PROVIDERS = "true";
    process.env.LLM_FALLBACKS = "claude";
    process.env.LLM_CLAUDE_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-key";
    callEndpoint
      .mockRejectedValueOnce(new LlmCallError("primary is down"))
      .mockResolvedValueOnce(answer("claude-sonnet-4-6"));

    await expect(call()).resolves.toMatchObject({ data: { ok: true } });
    expect(callEndpoint.mock.calls[1][0].provider).toBe("anthropic");
  });

  it("still retries validation failures on the endpoint that answered", async () => {
    withSpare();
    callEndpoint
      .mockResolvedValueOnce({ ...answer("primary-model"), text: '{"ok":"yes"}' })
      .mockResolvedValueOnce(answer("primary-model"));

    const res = await call();
    expect(res.meta.attempts).toBe(2);
    // Bad JSON is our problem, not the provider's — it must not burn the spare.
    expect(callEndpoint.mock.calls.every((c) => c[0].name === "primary")).toBe(true);
  });
});
