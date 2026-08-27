import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

// Type-only: erased at compile time, so the runtime dependency runs one way
// (endpoints -> providers) and there is no import cycle.
import type { LlmEndpoint } from "./endpoints";

/**
 * Provider adapter.
 *
 * The build spec locks the LLM to the Anthropic SDK. That still works and is
 * selected with LLM_PROVIDER=anthropic, but it requires paid API credits, and
 * this build had to be free to run.
 *
 * The default is therefore Groq, chosen over the other free option on data
 * terms rather than price: Groq's services agreement forbids training on
 * customer inputs and outputs, whereas Google AI Studio's free tier reserves
 * the right to review prompts and train on them. Resumes are sensitive
 * personal data, so that distinction decides it.
 *
 * Every provider is held to the same contract: a system prompt, one user turn,
 * and a single JSON object back. Everything downstream — validation, evidence
 * checking, drift detection — is provider-agnostic.
 */

export type ProviderName = "anthropic" | "gemini" | "groq";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Allow the model to reason before answering. On for tailoring/analysis, off for extraction. */
  thinking: boolean;
  signal: AbortSignal;
}

export interface LlmRawResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export class LlmConfigError extends Error {}
export class LlmCallError extends Error {}

/** Retryable: the provider's per-minute budget is momentarily exhausted. */
export class LlmRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

/**
 * The answer was cut off at the reserved length. Retryable with a bigger
 * reservation, which is what lets the defaults stay small.
 */
export class LlmTruncatedError extends Error {
  constructor(
    message: string,
    readonly reservedTokens: number,
    readonly headroomTokens: number,
  ) {
    super(message);
  }
}

/**
 * Providers that bill per token with no free allowance. Selecting one is a
 * legitimate choice, but it should never happen by accident.
 */
const PAID_PROVIDERS: ProviderName[] = ["anthropic"];

/**
 * Refuses to run a metered provider unless someone has said so out loud.
 *
 * The failure this prevents is quiet: paste a key, flip LLM_PROVIDER while
 * debugging, forget, and the bill arrives a month later. Everything this app
 * needs is available on a free tier, so spending money should require an
 * explicit act rather than an oversight. Set ALLOW_PAID_PROVIDERS=true to
 * opt in.
 */
export function paidProvidersAllowed(): boolean {
  return /^(true|1|yes)$/i.test((process.env.ALLOW_PAID_PROVIDERS ?? "").trim());
}

export function activeProvider(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "groq").trim().toLowerCase();
  if (raw !== "anthropic" && raw !== "gemini" && raw !== "groq") {
    throw new LlmConfigError(
      `LLM_PROVIDER must be one of "gemini", "anthropic", "groq" — got "${raw}".`,
    );
  }

  if (PAID_PROVIDERS.includes(raw) && !paidProvidersAllowed()) {
    throw new LlmConfigError(
      `LLM_PROVIDER is set to "${raw}", which bills per token with no free allowance. ` +
        `If that is deliberate, set ALLOW_PAID_PROVIDERS=true in .env.local. ` +
        `If it is not, switch to "groq" (free tier) or point OPENAI_COMPATIBLE_BASE_URL at a local Ollama.`,
    );
  }

  return raw;
}

/** The OpenAI-compatible endpoint in use — Groq, Cerebras, OpenRouter, Ollama, … */
export function compatibleBaseUrl(): string {
  return (
    process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() || "https://api.groq.com/openai/v1"
  ).replace(/\/$/, "");
}

/**
 * A model served from this machine has no account, no key and no quota. That
 * changes three things downstream: no auth header, no token budgeting, and no
 * rate-limit handling — so it is worth detecting explicitly.
 */
export function isLocalUrl(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(baseUrl);
}

export function isLocalEndpoint(baseUrl = compatibleBaseUrl()): boolean {
  return isLocalUrl(baseUrl);
}

export function activeModel(provider: ProviderName = activeProvider()): string {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
    case "gemini":
      return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    case "groq":
      return process.env.OPENAI_COMPATIBLE_MODEL?.trim() || "openai/gpt-oss-120b";
  }
}

/** Whether the selected provider has a usable key. Surfaced in the UI as a setup hint. */
export function providerReady(provider: ProviderName = activeProvider()): boolean {
  switch (provider) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    case "gemini":
      return Boolean(process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
    case "groq":
      // A locally served model needs no key at all.
      return Boolean(process.env.OPENAI_COMPATIBLE_API_KEY?.trim()) || isLocalEndpoint();
  }
}

export function missingKeyMessage(provider: ProviderName = activeProvider()): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.";
    case "gemini":
      return "GOOGLE_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey, add it to .env.local and restart the dev server.";
    case "groq":
      return `OPENAI_COMPATIBLE_API_KEY is not set for ${compatibleBaseUrl()}. Get a free key at https://console.groq.com/keys, add it to .env.local and restart the dev server. A local Ollama needs no key at all — point OPENAI_COMPATIBLE_BASE_URL at http://localhost:11434/v1.`;
  }
}

// ─────────────────────────── anthropic ───────────────────────────

// Keyed by credential rather than a single singleton: a chain may hold more
// than one endpoint for the same provider.
const anthropicClients = new Map<string, Anthropic>();

async function callAnthropic(e: LlmEndpoint, req: LlmRequest): Promise<LlmRawResponse> {
  const apiKey = e.apiKey;
  if (!apiKey) throw new LlmConfigError(missingKeyMessage("anthropic"));
  let client = anthropicClients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    anthropicClients.set(apiKey, client);
  }

  const model = e.model;
  const res = await client.messages.create(
    {
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system: req.system,
      messages: [
        { role: "user", content: req.user },
        // Prefill the assistant turn with "{" to force immediate JSON (§5.0).
        { role: "assistant", content: "{" },
      ],
    },
    { signal: req.signal },
  );

  const body = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  return {
    // The prefilled "{" is not echoed back by the API — put it back.
    text: `{${body}`,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    model,
  };
}

// ──────────────────────────── gemini ─────────────────────────────

const geminiClients = new Map<string, GoogleGenAI>();

async function callGemini(e: LlmEndpoint, req: LlmRequest): Promise<LlmRawResponse> {
  const apiKey = e.apiKey;
  if (!apiKey) throw new LlmConfigError(missingKeyMessage("gemini"));
  let client = geminiClients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    geminiClients.set(apiKey, client);
  }

  const model = e.model;
  // Gemini has no assistant prefill, but responseMimeType is a harder guarantee:
  // the decoder itself is constrained to JSON.
  const res = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    config: {
      systemInstruction: req.system,
      temperature: req.temperature,
      // Thinking tokens are drawn from the same budget as output tokens, so
      // headroom is doubled whenever reasoning is enabled.
      maxOutputTokens: req.thinking ? Math.min(req.maxTokens * 2, 32768) : req.maxTokens,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: req.thinking ? -1 : 0 },
      abortSignal: req.signal,
    },
  });

  const text = res.text ?? "";
  if (!text.trim()) {
    const reason = res.candidates?.[0]?.finishReason ?? "unknown";
    throw new LlmCallError(`Gemini returned no content (finishReason: ${reason}).`);
  }

  return {
    text,
    inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    model,
  };
}

// ──────────────── groq / any OpenAI-compatible endpoint ───────────────

/**
 * Groq's free tier is capped at 8,000 tokens per minute, and — this is the
 * part that bites — the cap is charged against `prompt_tokens +
 * max_completion_tokens`, not against what the model actually produces.
 * Reserving a comfortable 8,192 for the answer therefore fails outright with a
 * 413 before a single token is generated. So the reservation is trimmed to fit
 * the remaining budget rather than requested optimistically.
 */
/** Rough but deliberately pessimistic: English JSON runs about 3.6 chars/token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Below this there is no point starting: the answer cannot fit. */
const MIN_USEFUL_COMPLETION = 1200;

function parseRetryAfter(res: Response, body: string): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  // Groq also states the wait inside the message, e.g. "try again in 7.66s".
  const inBody = body.match(/try again in ([\d.]+)s/i);
  if (inBody) return Math.ceil(Number(inBody[1]));
  return 20;
}

async function callOpenAiCompatible(e: LlmEndpoint, req: LlmRequest): Promise<LlmRawResponse> {
  const baseUrl = e.baseUrl;
  const local = e.local;
  const apiKey = e.apiKey;
  if (!apiKey && !local) throw new LlmConfigError(missingKeyMessage("groq"));
  const model = e.model;

  // Nothing is metered on a model you are running yourself, so the reservation
  // can simply be what the prompt asked for.
  const budget = local ? Number.POSITIVE_INFINITY : e.tpm;
  const promptTokens = estimateTokens(req.system) + estimateTokens(req.user);
  // Leave a little slack: our estimate is not the provider's tokeniser.
  const headroom = budget - promptTokens - 200;

  if (!local && headroom < MIN_USEFUL_COMPLETION) {
    throw new LlmCallError(
      `This request needs roughly ${promptTokens.toLocaleString()} tokens of input, which leaves too little of the ${budget.toLocaleString()}-token-per-minute limit for a reply. Shorten the resume or job description, or move to a higher tier.`,
    );
  }

  const maxCompletion = Math.min(req.maxTokens, headroom);

  const body: Record<string, unknown> = {
    model,
    temperature: req.temperature,
    max_completion_tokens: maxCompletion,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };

  // gpt-oss models reason before answering, and Groq exposes that as a dial.
  // Reasoning is charged as completion tokens, so on a tight budget it competes
  // directly with the JSON we actually need — high effort with little headroom
  // buys better thinking and a truncated answer.
  //
  // Gated on the model id because sending it to a model that does not support
  // it is an error, and gated on `!local` because Ollama serves gpt-oss under
  // the same name but rejects the parameter.
  if (!local && /gpt-oss/i.test(model)) {
    body.reasoning_effort = req.thinking && maxCompletion >= 5000 ? "medium" : "low";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");

    if (res.status === 429) {
      const wait = parseRetryAfter(res, detail);
      throw new LlmRateLimitError(
        `Rate limit reached on the ${budget.toLocaleString()}-tokens-per-minute tier. Retrying in ${wait}s.`,
        wait,
      );
    }

    if (res.status === 413) {
      throw new LlmCallError(
        `This request is too large for the ${budget.toLocaleString()}-tokens-per-minute limit. Shorten the resume or job description, or move to a higher tier.`,
      );
    }

    throw new LlmCallError(`${baseUrl} returned ${res.status}. ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = json.choices?.[0];

  // A truncated answer is never valid JSON. Retrying the same request would
  // burn budget to fail identically, so this is raised as its own error and the
  // caller retries with a larger reservation instead.
  if (choice?.finish_reason === "length") {
    throw new LlmTruncatedError(
      `The reply was cut off at ${maxCompletion.toLocaleString()} tokens.`,
      maxCompletion,
      headroom,
    );
  }

  return {
    text: choice?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    model,
  };
}

/**
 * Send one request to one endpoint. Knows nothing about fallbacks: choosing
 * which endpoint to try, and when to give up on it, belongs to the caller.
 */
export function callEndpoint(e: LlmEndpoint, req: LlmRequest): Promise<LlmRawResponse> {
  switch (e.provider) {
    case "anthropic":
      return callAnthropic(e, req);
    case "gemini":
      return callGemini(e, req);
    case "groq":
      return callOpenAiCompatible(e, req);
  }
}
