import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { callStructured } from "@/lib/llm/client";
import { tailorEnginePrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { assertWithinRateLimit } from "@/lib/rateLimit";
import { ownedJobDescription, ownedSourceResume } from "@/lib/ownership";
import { MatchAnalysisSchema } from "@/lib/schema/analysis";
import type { JDProfile } from "@/lib/schema/jd";
import type { ResumeDoc } from "@/lib/schema/resume";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { checkEvidence, stripUnsupported } from "@/lib/validate/evidence";
import { findForbiddenKeywords } from "@/lib/validate/keywords";
import { sanitiseResumeDoc } from "@/lib/validate/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  jobDescriptionId: z.string().min(1),
  sourceResumeId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await assertWithinRateLimit(userId);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Select a job description and a resume first.");
    const { jobDescriptionId, sourceResumeId } = parsed.data;

    const [jd, source, cachedAnalysis] = await Promise.all([
      ownedJobDescription(userId, jobDescriptionId),
      ownedSourceResume(userId, sourceResumeId),
      prisma.analysis.findFirst({ where: { userId, jobDescriptionId, sourceResumeId } }),
    ]);

    if (!cachedAnalysis) {
      throw new BadRequestError("Run the gap analysis before generating a tailored resume.");
    }

    const jdProfile = jd.parsedJson as unknown as JDProfile;
    const analysis = MatchAnalysisSchema.parse(cachedAnalysis.resultJson);
    const originalResume = source.parsedJson as unknown as ResumeDoc;

    const { data: result } = await callStructured({
      ...tailorEnginePrompt({
        jdProfile,
        analysis,
        resume: originalResume,
        rawResumeText: source.rawText,
      }),
      userId,
    });

    // ── Post-generation validation (§4, §5.7) ────────────────────────────
    // Bullets and skills whose sourceEvidence cannot be traced back to the
    // original resume are dropped, and the rejection is surfaced rather than
    // hidden — a claim the candidate cannot defend is worse than a gap.
    // Normalise typographic look-alikes first. A non-breaking hyphen in
    // "drop-off" would otherwise split the token and drag the overlap score
    // below threshold, rejecting a bullet that is perfectly well evidenced.
    const normalised = sanitiseResumeDoc(result.resume);

    const evidence = checkEvidence(normalised, source.rawText);
    const cleanedResume = evidence.passed
      ? normalised
      : stripUnsupported(normalised, evidence.failures);

    const forbidden = findForbiddenKeywords(cleanedResume, analysis);

    const contentJson = ResumeDocSchema.parse(cleanedResume);

    const row = await prisma.tailoredResume.create({
      data: {
        userId,
        jobDescriptionId,
        sourceResumeId,
        version: 1,
        contentJson,
        analysisJson: analysis,
        changeLogJson: result.changeLog,
        note: "Initial tailored draft",
      },
      select: { id: true, version: true, createdAt: true },
    });

    return NextResponse.json({
      tailoredResumeId: row.id,
      version: row.version,
      resume: contentJson,
      changeLog: result.changeLog,
      analysis,
      projectedAtsScore: result.projectedAtsScore,
      remainingGaps: result.remainingGaps,
      evidence: {
        checkedBullets: evidence.checkedBullets,
        checkedSkills: evidence.checkedSkills,
        // These were removed from the document that was just saved, which is
        // what distinguishes this from the re-verification done on reload.
        dropped: true,
        issues: evidence.failures.map((f) => ({
          kind: f.kind,
          where: f.where,
          text: f.text,
          reason: f.reason,
          overlap: Math.round(f.overlap * 100),
        })),
      },
      forbiddenKeywordHits: forbidden,
    });
  } catch (err) {
    return routeError(err);
  }
}
