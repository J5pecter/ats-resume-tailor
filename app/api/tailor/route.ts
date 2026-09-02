import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { runTailorPipeline } from "@/lib/pipeline/tailor";
import { prisma } from "@/lib/prisma";
import { assertWithinRateLimit } from "@/lib/rateLimit";
import { ownedJobDescription, ownedSourceResume } from "@/lib/ownership";
import { MatchAnalysisSchema } from "@/lib/schema/analysis";
import type { JDProfile } from "@/lib/schema/jd";
import type { ResumeDoc } from "@/lib/schema/resume";

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

    // Generation and every guard, in the order that matters. Shared with the
    // evaluation harness so the two cannot measure different pipelines.
    const outcome = await runTailorPipeline({
      jdProfile,
      analysis,
      resume: originalResume,
      rawResumeText: source.rawText,
      userId,
    });

    const row = await prisma.tailoredResume.create({
      data: {
        userId,
        jobDescriptionId,
        sourceResumeId,
        version: 1,
        contentJson: outcome.resume,
        analysisJson: analysis,
        changeLogJson: outcome.changeLog,
        note: "Initial tailored draft",
      },
      select: { id: true, version: true, createdAt: true },
    });

    return NextResponse.json({
      tailoredResumeId: row.id,
      version: row.version,
      resume: outcome.resume,
      changeLog: outcome.changeLog,
      analysis,
      projectedAtsScore: outcome.projectedAtsScore,
      remainingGaps: outcome.remainingGaps,
      evidence: {
        checkedBullets: outcome.evidence.checkedBullets,
        checkedSkills: outcome.evidence.checkedSkills,
        // These were removed from the document that was just saved, which is
        // what distinguishes this from the re-verification done on reload.
        dropped: true,
        issues: outcome.evidence.failures.map((f) => ({
          kind: f.kind,
          where: f.where,
          text: f.text,
          reason: f.reason,
          overlap: Math.round(f.overlap * 100),
        })),
      },
      forbiddenKeywordHits: outcome.forbiddenHits,
      forbiddenRemoved: outcome.forbiddenRemoved,
      retention: {
        originalBullets: outcome.retention.originalBullets,
        keptBullets: outcome.retention.keptBullets,
        originalSkills: outcome.retention.originalSkills,
        keptSkills: outcome.retention.keptSkills,
        substantialLoss: outcome.retention.substantialLoss,
        dropped: outcome.retention.dropped.slice(0, 30),
      },
    });
  } catch (err) {
    return routeError(err);
  }
}
