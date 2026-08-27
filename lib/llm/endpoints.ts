import "server-only";

import {
  type ProviderName,
  LlmConfigError,
  isLocalUrl,
  paidProvidersAllowed,
} from "./providers";

/**
 * Where a model call can actually be sent.
 *
 * The app was built to run for nothing, and the awkward part of that promise is
 * that none of it is ours to keep: a free tier belongs to the provider offering
 * it, and any of them may tighten limits, require a card, or shut down. What
 * *can* be built is an app that survives that happening — so a dead tier costs
 * an afternoon of annoyance instead of the app.
 *
 * Hence a chain rather than a single provider. The primary is tried first;
 * anything that looks like the provider's fault rather than ours moves to the
 * next one. Adding a spare is a handful of environment variables, and the
 * plumbing that follows — validation, evidence, drift — never learns which
 * endpoint answered.
 */
export interface LlmEndpoint {
  /** Label used in logs and setup output. The primary is always "primary". */
  name: string;
  provider: ProviderName;
  model: string;
  /** Only meaningful for OpenAI-compatible providers. */
  baseUrl: string;
  apiKey: string;
  /** Tokens-per-minute ceiling for OpenAI-compatible endpoints. */
  tpm: number;
  /** Bills per token with no free allowance. */
  metered: boolean;
  /** Served from this machine: no key, no quota, no metering. */
  local: boolean;
}

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_TPM = 8000;

/** Providers that bill per token with no free allowance. */
export const METERED_PROVIDERS: ProviderName[] = ["anthropic"];

function normaliseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function parseProvider(raw: string, where: string): ProviderName {
  const value = raw.trim().toLowerCase();
  if (value === "anthropic" || value === "gemini" || value === "groq") return value;
  throw new LlmConfigError(
    `${where} must be one of "gemini", "anthropic", "groq" — got "${raw}".`,
  );
}

function defaultModel(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-6";
    case "gemini":
      return "gemini-2.5-flash";
    case "groq":
      return "openai/gpt-oss-120b";
  }
}

function keyFor(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    case "gemini":
      return (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
    case "groq":
      return process.env.OPENAI_COMPATIBLE_API_KEY?.trim() ?? "";
  }
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function endpoint(partial: Omit<LlmEndpoint, "metered" | "local">): LlmEndpoint {
  const local = partial.provider === "groq" && isLocalUrl(partial.baseUrl);
  return {
    ...partial,
    local,
    // A model on your own machine is free whatever the provider charges, so
    // the metered flag tracks the provider, not the name it is filed under.
    metered: METERED_PROVIDERS.includes(partial.provider) && !local,
  };
}

/** The endpoint named by LLM_PROVIDER and its long-standing variables. */
export function primaryEndpoint(): LlmEndpoint {
  const provider = parseProvider(process.env.LLM_PROVIDER ?? "groq", "LLM_PROVIDER");
  const model =
    provider === "anthropic"
      ? process.env.ANTHROPIC_MODEL?.trim() || defaultModel(provider)
      : provider === "gemini"
        ? process.env.GEMINI_MODEL?.trim() || defaultModel(provider)
        : process.env.OPENAI_COMPATIBLE_MODEL?.trim() || defaultModel(provider);

  return endpoint({
    name: "primary",
    provider,
    model,
    baseUrl: normaliseUrl(process.env.OPENAI_COMPATIBLE_BASE_URL || DEFAULT_BASE_URL),
    apiKey: keyFor(provider),
    tpm: positiveNumber(process.env.OPENAI_COMPATIBLE_TPM, DEFAULT_TPM),
  });
}

/** Environment-variable prefix for a fallback slot: "open router" -> LLM_OPEN_ROUTER_ */
function slotPrefix(slot: string): string {
  return `LLM_${slot.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;
}

function fallbackEndpoint(slot: string): LlmEndpoint {
  const p = slotPrefix(slot);
  // Slots default to the OpenAI-compatible adapter, because that is what every
  // free endpoint worth adding as a spare happens to speak.
  const provider = parseProvider(process.env[`${p}PROVIDER`] ?? "groq", `${p}PROVIDER`);
  const baseUrl = normaliseUrl(process.env[`${p}BASE_URL`] || DEFAULT_BASE_URL);

  return endpoint({
    name: slot.trim(),
    provider,
    model: process.env[`${p}MODEL`]?.trim() || defaultModel(provider),
    baseUrl,
    // Falling back to the shared key is deliberate: pointing a slot at a
    // different model on the same provider is a normal thing to want, and
    // should not require pasting the key twice.
    apiKey: process.env[`${p}API_KEY`]?.trim() || keyFor(provider),
    tpm: positiveNumber(process.env[`${p}TPM`], DEFAULT_TPM),
  });
}

/** An endpoint can be attempted: it has a key, or needs none. */
export function endpointReady(e: LlmEndpoint): boolean {
  return e.local || Boolean(e.apiKey);
}

export function describeEndpoint(e: LlmEndpoint): string {
  const where = e.provider === "groq" ? ` @ ${e.baseUrl}` : "";
  return `${e.name} (${e.provider}:${e.model}${where})`;
}

export interface ResolvedChain {
  endpoints: LlmEndpoint[];
  /** Configured but unusable, with the reason — surfaced in setup output. */
  skipped: { endpoint: LlmEndpoint; reason: string }[];
}

/**
 * The ordered list of endpoints a call may use.
 *
 * Two things are filtered out rather than attempted. An endpoint with no key
 * would fail on every call, and a metered one would quietly start spending —
 * the failure this whole design exists to prevent. Both are reported rather
 * than dropped in silence, because a spare you believe you have and do not is
 * worse than no spare at all.
 */
export function resolveChain(): ResolvedChain {
  const slots = (process.env.LLM_FALLBACKS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = [primaryEndpoint(), ...slots.map(fallbackEndpoint)];
  const endpoints: LlmEndpoint[] = [];
  const skipped: { endpoint: LlmEndpoint; reason: string }[] = [];
  const allowPaid = paidProvidersAllowed();

  for (const e of candidates) {
    if (e.metered && !allowPaid) {
      skipped.push({
        endpoint: e,
        reason: `${e.provider} bills per token with no free allowance. Set ALLOW_PAID_PROVIDERS=true to use it deliberately.`,
      });
      continue;
    }
    if (!endpointReady(e)) {
      skipped.push({ endpoint: e, reason: "no API key configured" });
      continue;
    }
    endpoints.push(e);
  }

  return { endpoints, skipped };
}
