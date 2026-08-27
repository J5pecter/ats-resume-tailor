import { NextResponse } from "next/server";
import { routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { checkEvidence } from "@/lib/validate/evidence";
import { checkRetention } from "@/lib/validate/retention";

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

    const [latestTailored, latestJd] = await Promise.all([
      prisma.tailoredResume.findFirst({ where: { userId }, orderBy: [{ createdAt: "desc" }] }),
      prisma.jobDescription.findFirst({ where: { userId }, orderBy: [{ createdAt: "desc" }] }),
    ]);

    // Restore whatever the user touched last, not whatever was last *generated*.
    // Starting a new job description is the clearest possible signal that the
    // previous tailored document is finished with; reopening on it instead
    // would silently hide the work they had just begun.
    const tailoredIsCurrent =
      latestTailored !== null &&
      (latestJd === null || latestTailored.createdAt >= latestJd.createdAt);

    if (tailoredIsCurrent && latestTailored) {
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

        // Recomputed here rather than stored alongside the document, for the
        // same reason evidence is: a stored verdict is a snapshot of the rules
        // as they were on the day it was written. These rules have already
        // changed once — kept counts used to measure the output instead of the
        // survivors — and a persisted number would have carried that error
        // forward for every document produced before the fix. Both inputs are
        // already loaded, so recomputing costs nothing and is always current.
        const originalDoc = ResumeDocSchema.safeParse(source.parsedJson);
        const retention =
          restored.success && originalDoc.success
            ? checkRetention(originalDoc.data, restored.data)
            : null;

        return NextResponse.json({
          jd: { id: jd.id, title: jd.title, profile: jd.parsedJson },
          resume: { id: source.id, label: source.label, doc: source.parsedJson },
          analysis: analysis?.resultJson ?? latestTailored.analysisJson,
          tailored: {
            // Says out loud that this was reopened, not produced just now. The
            // client cannot infer it: the payload is otherwise identical to a
            // fresh generation's.
            restored: { generatedAt: new Date(latestTailored.createdAt).toISOString() },
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
            // Absent when either document failed to parse, which the client
            // already treats as "nothing to report" rather than "nothing lost".
            retention: retention
              ? {
                  originalBullets: retention.originalBullets,
                  keptBullets: retention.keptBullets,
                  originalSkills: retention.originalSkills,
                  keptSkills: retention.keptSkills,
                  substantialLoss: retention.substantialLoss,
                  dropped: retention.dropped.slice(0, 30),
                }
              : undefined,
          },
        });
      }
    }

    // Either nothing has been generated yet, or a newer job description has
    // been started since. Restore the inputs so the job description does not
    // have to be pasted again.
    const jd = latestJd;
    if (!jd) return NextResponse.json({ jd: null, resume: null, analysis: null, tailored: null });

    // Only a resume that belongs to this job description's work. A resume left
    // over from a previous, unrelated tailoring run is not part of it, and
    // showing it would suggest step two was already done.
    const source = await prisma.sourceResume.findFirst({
      where: { userId, createdAt: { gte: jd.createdAt } },
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
