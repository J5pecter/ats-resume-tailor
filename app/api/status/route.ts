import { NextResponse } from "next/server";
import { auth, googleEnabled } from "@/lib/auth";
import { activeModel, activeProvider, missingKeyMessage, providerReady } from "@/lib/llm/providers";
import { resolveChain } from "@/lib/llm/endpoints";
import { mailTransportName } from "@/lib/auth/mail";
import { sheetLoggingEnabled } from "@/lib/auth/audit";
import { generationLimit, generationsRemaining } from "@/lib/rateLimit";
import { routeError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setup/health information for the UI. Exposes no secrets — only readiness. */
export async function GET() {
  try {
    const session = await auth();
    let provider: string;
    let ready: boolean;
    let model: string;
    let hint: string | null = null;
    // Names only — never a key, and never the URL of a private endpoint.
    let fallbacks: string[] = [];

    try {
      const p = activeProvider();
      provider = p;
      ready = providerReady(p);
      model = activeModel(p);
      if (!ready) hint = missingKeyMessage(p);
      // A spare you believe you have and do not is worse than no spare, so the
      // ones that actually resolved are reported rather than the ones listed.
      fallbacks = resolveChain()
        .endpoints.filter((e) => e.name !== "primary")
        .map((e) => e.name);
    } catch (err) {
      provider = process.env.LLM_PROVIDER ?? "gemini";
      ready = false;
      model = "unknown";
      hint = (err as Error).message;
    }

    return NextResponse.json({
      llm: { provider, model, ready, hint, fallbacks },
      googleEnabled: googleEnabled(),
      mail: mailTransportName(),
      sheetLogging: sheetLoggingEnabled(),
      quota: session?.user?.id
        ? { remaining: await generationsRemaining(session.user.id), limit: generationLimit() }
        : null,
    });
  } catch (err) {
    return routeError(err);
  }
}
