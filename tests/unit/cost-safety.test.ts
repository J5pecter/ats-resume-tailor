import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmConfigError, activeProvider, paidProvidersAllowed } from "@/lib/llm/providers";

/**
 * The app must never start spending money because someone changed a variable
 * and forgot. Everything it needs runs on a free tier, so a metered provider
 * has to be opted into out loud.
 */

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.ALLOW_PAID_PROVIDERS;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("cost safety", () => {
  it("defaults to a free provider when nothing is configured", () => {
    expect(activeProvider()).toBe("groq");
  });

  it("refuses a metered provider that was not opted into", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(() => activeProvider()).toThrow(LlmConfigError);
    expect(() => activeProvider()).toThrow(/bills per token/);
  });

  it("names the escape hatch in the error, so the fix is obvious", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(() => activeProvider()).toThrow(/ALLOW_PAID_PROVIDERS=true/);
  });

  it("allows a metered provider once opted into explicitly", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ALLOW_PAID_PROVIDERS = "true";
    expect(activeProvider()).toBe("anthropic");
  });

  it("does not treat a stray value as consent", () => {
    process.env.LLM_PROVIDER = "anthropic";
    for (const value of ["", "false", "no", "0", "maybe", "TRUE-ish"]) {
      process.env.ALLOW_PAID_PROVIDERS = value;
      expect(paidProvidersAllowed(), `"${value}" must not count as consent`).toBe(false);
      expect(() => activeProvider()).toThrow(LlmConfigError);
    }
  });

  it("never blocks the free providers", () => {
    for (const provider of ["groq", "gemini"]) {
      process.env.LLM_PROVIDER = provider;
      expect(activeProvider()).toBe(provider);
    }
  });

  it("still rejects an unknown provider outright", () => {
    process.env.LLM_PROVIDER = "openai";
    expect(() => activeProvider()).toThrow(/must be one of/);
  });
});
