import { NextResponse } from "next/server";
import { auth, googleEnabled } from "@/lib/auth";
import { activeModel, activeProvider, missingKeyMessage, providerReady } from "@/lib/llm/providers";
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

    try {
      const p = activeProvider();
      provider = p;
      ready = providerReady(p);
      model = activeModel(p);
      if (!ready) hint = missingKeyMessage(p);
    } catch (err) {
      provider = process.env.LLM_PROVIDER ?? "gemini";
      ready = false;
      model = "unknown";
      hint = (err as Error).message;
    }

    return NextResponse.json({
      llm: { provider, model, ready, hint },
      googleEnabled: googleEnabled(),
      quota: session?.user?.id
        ? { remaining: await generationsRemaining(session.user.id), limit: generationLimit() }
        : null,
    });
  } catch (err) {
    return routeError(err);
  }
}
