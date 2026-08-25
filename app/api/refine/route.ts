import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { callStructured } from "@/lib/llm/client";
import { refineEnginePrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { assertWithinRateLimit } from "@/lib/rateLimit";
import { ownedTailoredResume } from "@/lib/ownership";
import type { JDProfile } from "@/lib/schema/jd";
import { ResumeDocSchema, type ResumeDoc } from "@/lib/schema/resume";
import type { ChangeLogEntry } from "@/lib/schema/tailor";
import type { RefineResult } from "@/lib/schema/refine";
import { detectDrift } from "@/lib/validate/drift";
import { sanitiseResumeDoc } from "@/lib/validate/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  tailoredResumeId: z.string().min(1),
  instruction: z.string().trim().min(3, "Tell me what to change.").max(2000),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await assertWithinRateLimit(userId);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Tell me what to change.");
    }

    const current = await ownedTailoredResume(userId, parsed.data.tailoredResumeId);
    const jd = await prisma.jobDescription.findFirst({
      where: { id: current.jobDescriptionId, userId },
    });
    if (!jd) throw new BadRequestError("The job description for this resume is no longer available.");

    const before = ResumeDocSchema.parse(current.contentJson);
    const prompt = refineEnginePrompt({
      jdProfile: jd.parsedJson as unknown as JDProfile,
      current: before,
      instruction: parsed.data.instruction,
    });

    // Models drift on "change nothing else" more than you'd expect, so the
    // declared change list is verified against an actual field-by-field diff
    // and a drifting response is thrown away and retried once (§5.5).
    let result: RefineResult | null = null;
    let drift = null as ReturnType<typeof detectDrift> | null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { data } = await callStructured({ ...prompt, userId });

      if (data.needsClarification) {
        return NextResponse.json({
          applied: false,
          needsClarification: data.needsClarification,
        });
      }

      // Sanitised before diffing, so a model swapping a hyphen for a
      // non-breaking one does not register as an undeclared content change.
      data.resume = sanitiseResumeDoc(data.resume);
      const report = detectDrift(before, data.resume, data.changesApplied);
      if (!report.hasDrift) {
        result = data;
        drift = report;
        break;
      }
      result = data;
      drift = report;
    }

    if (!result || !drift) {
      throw new BadRequestError("The refinement could not be completed. Try rephrasing.");
    }

    if (drift.hasDrift) {
      // Nothing is persisted. Silent drift in a resume is a serious bug, so the
      // change is discarded and reported rather than quietly accepted.
      return NextResponse.json({
        applied: false,
        drift: drift.undeclared.slice(0, 12),
        error:
          "The model altered parts of the resume it was not asked to touch, twice in a row, so the change was discarded. Nothing was saved. Try a more specific instruction.",
      });
    }

    if (drift.changed.length === 0) {
      return NextResponse.json({
        applied: false,
        error: "That instruction produced no change to the document.",
        warnings: result.warnings,
      });
    }

    const latest = await prisma.tailoredResume.findFirst({
      where: { userId, jobDescriptionId: current.jobDescriptionId, sourceResumeId: current.sourceResumeId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const changeLog: ChangeLogEntry[] = result.changesApplied.map((c) => ({
      section: c.section,
      changeType: "reworded" as const,
      before: c.before,
      after: c.after,
      rationale: parsed.data.instruction,
      keywordsTargeted: [],
    }));

    // Never mutate in place — every accepted refinement is a new version (§3).
    const row = await prisma.tailoredResume.create({
      data: {
        userId,
        jobDescriptionId: current.jobDescriptionId,
        sourceResumeId: current.sourceResumeId,
        version: (latest?.version ?? current.version) + 1,
        contentJson: ResumeDocSchema.parse(result.resume) as unknown as object,
        analysisJson: current.analysisJson as object,
        changeLogJson: changeLog,
        note: parsed.data.instruction.slice(0, 200),
      },
      select: { id: true, version: true },
    });

    return NextResponse.json({
      applied: true,
      tailoredResumeId: row.id,
      version: row.version,
      resume: result.resume as ResumeDoc,
      changesApplied: result.changesApplied,
      needsVerification: result.needsVerification,
      warnings: result.warnings,
    });
  } catch (err) {
    return routeError(err);
  }
}
