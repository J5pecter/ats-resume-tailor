import { NextResponse } from "next/server";
import { routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { checkEvidence } from "@/lib/validate/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rehydrates the dashboard after a reload.
 *
 * A tailored resume is expensive to produce, so losing it to a refresh would
 * be the most annoying possible bug. This returns the most recent lineage the
 * user was working on: the job description, the source resume, the cached gap
 * analysis, and the latest version of the tailored document.
 */
export async function GET() {
  try {
    const userId = await requireUserId();

    const latestTailored = await prisma.tailoredResume.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
    });

    if (latestTailored) {
      const [jd, source, analysis] = await Promise.all([
        prisma.jobDescription.findFirst({
          where: { id: latestTailored.jobDescriptionId, userId },
        }),
        prisma.sourceResume.findFirst({
          where: { id: latestTailored.sourceResumeId, userId },
        }),
        prisma.analysis.findFirst({
          where: {
            userId,
            jobDescriptionId: latestTailored.jobDescriptionId,
            sourceResumeId: latestTailored.sourceResumeId,
          },
        }),
      ]);

      if (jd && source) {
        // Parse rather than passing contentJson through raw: documents saved
        // before skills carried evidence are still plain strings on disk, and
        // the schema upgrades them on the way out so the client only ever sees
        // one shape.
        const restored = ResumeDocSchema.safeParse(latestTailored.contentJson);
        const resumeDoc = restored.success ? restored.data : latestTailored.contentJson;

        // Re-verify rather than reporting zeroes. Nothing is dropped here —
        // anything that fails is reported as unverified, not rejected, because
        // this document was stored, not just generated.
        const evidence = restored.success
          ? checkEvidence(restored.data, source.rawText)
          : null;

        return NextResponse.json({
          jd: { id: jd.id, title: jd.title, profile: jd.parsedJson },
          resume: { id: source.id, label: source.label, doc: source.parsedJson },
          analysis: analysis?.resultJson ?? latestTailored.analysisJson,
          tailored: {
            tailoredResumeId: latestTailored.id,
            version: latestTailored.version,
            resume: resumeDoc,
            changeLog: latestTailored.changeLogJson,
            analysis: latestTailored.analysisJson,
            projectedAtsScore: 0,
            remainingGaps: [],
            evidence: {
              checkedBullets: evidence?.checkedBullets ?? 0,
              checkedSkills: evidence?.checkedSkills ?? 0,
              dropped: false,
              issues: (evidence?.failures ?? []).map((f) => ({
                kind: f.kind,
                where: f.where,
                text: f.text,
                reason: f.reason,
                overlap: Math.round(f.overlap * 100),
              })),
            },
            forbiddenKeywordHits: [],
          },
        });
      }
    }

    // No generated document yet — restore whatever inputs exist so the user
    // does not have to paste the job description again.
    const jd = await prisma.jobDescription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (!jd) return NextResponse.json({ jd: null, resume: null, analysis: null, tailored: null });

    const source = await prisma.sourceResume.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    const analysis = source
      ? await prisma.analysis.findFirst({
          where: { userId, jobDescriptionId: jd.id, sourceResumeId: source.id },
        })
      : null;

    return NextResponse.json({
      jd: { id: jd.id, title: jd.title, profile: jd.parsedJson },
      resume: source ? { id: source.id, label: source.label, doc: source.parsedJson } : null,
      analysis: analysis?.resultJson ?? null,
      tailored: null,
    });
  } catch (err) {
    return routeError(err);
  }
}
