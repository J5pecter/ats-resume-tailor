import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { callStructured } from "@/lib/llm/client";
import { gapAnalysisPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { ownedJobDescription, ownedSourceResume } from "@/lib/ownership";
import { MatchAnalysisSchema, type MatchAnalysis } from "@/lib/schema/analysis";
import type { JDProfile } from "@/lib/schema/jd";
import type { ResumeDoc } from "@/lib/schema/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  jobDescriptionId: z.string().min(1),
  sourceResumeId: z.string().min(1),
  /** Force a re-run even when a cached analysis exists for this pair. */
  refresh: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Select a job description and a resume first.");

    const { jobDescriptionId, sourceResumeId, refresh } = parsed.data;
    const [jd, source] = await Promise.all([
      ownedJobDescription(userId, jobDescriptionId),
      ownedSourceResume(userId, sourceResumeId),
    ]);

    if (!refresh) {
      const cached = await prisma.analysis.findFirst({
        where: { userId, jobDescriptionId, sourceResumeId },
      });
      if (cached) {
        return NextResponse.json({
          analysis: cached.resultJson as unknown as MatchAnalysis,
          cached: true,
        });
      }
    }

    const { data: analysis } = await callStructured({
      ...gapAnalysisPrompt(
        jd.parsedJson as unknown as JDProfile,
        source.parsedJson as unknown as ResumeDoc,
      ),
      userId,
    });

    const stored = MatchAnalysisSchema.parse(analysis);
    await prisma.analysis.upsert({
      where: { jobDescriptionId_sourceResumeId: { jobDescriptionId, sourceResumeId } },
      update: { resultJson: stored },
      create: { userId, jobDescriptionId, sourceResumeId, resultJson: stored },
    });

    return NextResponse.json({ analysis, cached: false });
  } catch (err) {
    return routeError(err);
  }
}
