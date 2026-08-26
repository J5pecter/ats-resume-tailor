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
import { findForbiddenKeywords, stripForbiddenKeywords } from "@/lib/validate/keywords";
import { sanitiseResumeDoc } from "@/lib/validate/sanitize";
import { checkRetention } from "@/lib/validate/retention";

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

    // Rule 4 is absolute: keywords the gap analysis marked MISSING are honest
    // gaps and must not appear. Detecting a violation is not enough — the
    // document would still ship with it — so anything carrying one is removed.
    //
    // The evidence check cannot catch these. A model can take a real bullet
    // with real evidence and append a clause the evidence does not support,
    // and every traceability test still passes.
    const { resume: guardedResume, removed: forbiddenRemoved } = stripForbiddenKeywords(
      cleanedResume,
      analysis,
    );
    const forbidden = findForbiddenKeywords(guardedResume, analysis);

    // What did the rewrite leave behind? Trimming is permitted; trimming
    // invisibly is not, because the candidate cannot restore what they cannot see.
    const retention = checkRetention(originalResume, guardedResume);

    const contentJson = ResumeDocSchema.parse(guardedResume);

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
      forbiddenRemoved,
      retention: {
        originalBullets: retention.originalBullets,
        keptBullets: retention.keptBullets,
        originalSkills: retention.originalSkills,
        keptSkills: retention.keptSkills,
        substantialLoss: retention.substantialLoss,
        dropped: retention.dropped.slice(0, 30),
      },
    });
  } catch (err) {
    return routeError(err);
  }
}
