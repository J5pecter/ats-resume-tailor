import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmConfigError } from "@/lib/llm/providers";
import { describeEndpoint, primaryEndpoint, resolveChain } from "@/lib/llm/endpoints";

/**
 * The app has to keep working for nothing when a free tier changes its mind.
 * These cover the two halves of that: a spare endpoint is actually reachable
 * when configured, and no spare can quietly become a bill.
 */

const saved = { ...process.env };

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(LLM_|OPENAI_COMPATIBLE_|ANTHROPIC_|GOOGLE_|GEMINI_|ALLOW_PAID)/.test(key)) {
      delete process.env[key];
    }
  }
});
afterEach(() => {
  process.env = { ...saved };
});

describe("endpoint chain", () => {
  it("is just the primary when no fallbacks are configured", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    const { endpoints, skipped } = resolveChain();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe("primary");
    expect(endpoints[0].provider).toBe("groq");
    expect(skipped).toEqual([]);
  });

  it("appends fallbacks in the order they are listed", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "spare,ollama";
    process.env.LLM_SPARE_API_KEY = "key-2";
    process.env.LLM_OLLAMA_BASE_URL = "http://localhost:11434/v1";

    const names = resolveChain().endpoints.map((e) => e.name);
    expect(names).toEqual(["primary", "spare", "ollama"]);
  });

  it("maps a slot name onto its environment prefix", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "open router";
    process.env.LLM_OPEN_ROUTER_API_KEY = "key-or";
    process.env.LLM_OPEN_ROUTER_MODEL = "some/free-model";
    process.env.LLM_OPEN_ROUTER_BASE_URL = "https://openrouter.ai/api/v1/";

    const spare = resolveChain().endpoints[1];
    expect(spare.apiKey).toBe("key-or");
    expect(spare.model).toBe("some/free-model");
    // Trailing slash removed, so the "/chat/completions" join stays correct.
    expect(spare.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("lets a fallback reuse the primary's key when it has none of its own", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "shared-key";
    process.env.LLM_FALLBACKS = "smaller";
    process.env.LLM_SMALLER_MODEL = "llama-3.1-8b-instant";

    const spare = resolveChain().endpoints[1];
    expect(spare.apiKey).toBe("shared-key");
    expect(spare.model).toBe("llama-3.1-8b-instant");
  });

  it("treats a locally served model as needing no key, and never metered", () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.OPENAI_COMPATIBLE_BASE_URL = "http://localhost:11434/v1";

    const e = primaryEndpoint();
    expect(e.local).toBe(true);
    expect(e.metered).toBe(false);
    expect(resolveChain().endpoints).toHaveLength(1);
  });

  it("carries a per-endpoint token budget", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.OPENAI_COMPATIBLE_TPM = "8000";
    process.env.LLM_FALLBACKS = "roomier";
    process.env.LLM_ROOMIER_API_KEY = "key-2";
    process.env.LLM_ROOMIER_TPM = "60000";

    const [primary, roomier] = resolveChain().endpoints;
    expect(primary.tpm).toBe(8000);
    expect(roomier.tpm).toBe(60000);
  });

  it("falls back to the default budget when the value is nonsense", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.OPENAI_COMPATIBLE_TPM = "not-a-number";
    expect(primaryEndpoint().tpm).toBe(8000);
  });
});

describe("chain cost safety", () => {
  it("refuses to put a metered provider in the chain by default", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "claude";
    process.env.LLM_CLAUDE_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-something";

    const { endpoints, skipped } = resolveChain();
    expect(endpoints.map((e) => e.name)).toEqual(["primary"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/bills per token/);
    expect(skipped[0].reason).toMatch(/ALLOW_PAID_PROVIDERS=true/);
  });

  it("admits a metered provider once opted into out loud", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.ALLOW_PAID_PROVIDERS = "true";
    process.env.LLM_FALLBACKS = "claude";
    process.env.LLM_CLAUDE_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-something";

    expect(resolveChain().endpoints.map((e) => e.name)).toEqual(["primary", "claude"]);
  });

  it("does not accept a stray value as consent to spend", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "claude";
    process.env.LLM_CLAUDE_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-something";

    for (const value of ["", "false", "no", "0", "maybe", "TRUE-ish"]) {
      process.env.ALLOW_PAID_PROVIDERS = value;
      expect(resolveChain().endpoints, `"${value}" must not enable spending`).toHaveLength(1);
    }
  });
});

describe("chain reporting", () => {
  it("reports an unusable fallback rather than dropping it silently", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "spare";
    // No LLM_SPARE_API_KEY, and the shared key belongs to the primary's
    // provider, so this one is genuinely unusable only if it points elsewhere.
    process.env.LLM_SPARE_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_SPARE_PROVIDER = "gemini";

    const { endpoints, skipped } = resolveChain();
    expect(endpoints).toHaveLength(1);
    expect(skipped[0].reason).toBe("no API key configured");
  });

  it("describes an endpoint well enough to tell two apart in a log", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "ollama";
    process.env.LLM_OLLAMA_BASE_URL = "http://localhost:11434/v1";
    process.env.LLM_OLLAMA_MODEL = "gpt-oss:20b";

    const [primary, ollama] = resolveChain().endpoints;
    expect(describeEndpoint(primary)).toContain("api.groq.com");
    expect(describeEndpoint(ollama)).toBe("ollama (groq:gpt-oss:20b @ http://localhost:11434/v1)");
  });

  it("rejects an unknown provider in a fallback slot, naming the slot", () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = "key-1";
    process.env.LLM_FALLBACKS = "weird";
    process.env.LLM_WEIRD_PROVIDER = "openai";

    expect(() => resolveChain()).toThrow(LlmConfigError);
    expect(() => resolveChain()).toThrow(/LLM_WEIRD_PROVIDER/);
  });
});
