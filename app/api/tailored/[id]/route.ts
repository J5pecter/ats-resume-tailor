import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedTailoredResume } from "@/lib/ownership";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { diffDocuments } from "@/lib/validate/drift";
import { sanitiseResumeDoc } from "@/lib/validate/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const row = await ownedTailoredResume(userId, id);
    const jd = await prisma.jobDescription.findFirst({
      where: { id: row.jobDescriptionId, userId },
      select: { title: true, parsedJson: true },
    });

    return NextResponse.json({
      tailoredResumeId: row.id,
      version: row.version,
      resume: row.contentJson,
      analysis: row.analysisJson,
      changeLog: row.changeLogJson,
      note: row.note,
      jobTitle: jd?.title ?? "",
      jdProfile: jd?.parsedJson ?? null,
      createdAt: row.createdAt,
    });
  } catch (err) {
    return routeError(err);
  }
}

const PatchBody = z.object({
  resume: ResumeDocSchema,
  note: z.string().trim().max(200).optional(),
});

/** Direct inline edits from the preview. Creates version+1; never mutates (§3). */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const current = await ownedTailoredResume(userId, id);

    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "That edit could not be saved.");
    }

    const before = ResumeDocSchema.parse(current.contentJson);
    // Applies to hand edits too: text pasted from Word carries curly quotes and
    // en dashes, and the ATS reading the export does not care who typed them.
    const edited = sanitiseResumeDoc(parsed.data.resume);
    const changes = diffDocuments(before, edited);
    if (changes.length === 0) {
      return NextResponse.json({ saved: false, reason: "Nothing changed." });
    }

    const latest = await prisma.tailoredResume.findFirst({
      where: {
        userId,
        jobDescriptionId: current.jobDescriptionId,
        sourceResumeId: current.sourceResumeId,
      },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const row = await prisma.tailoredResume.create({
      data: {
        userId,
        jobDescriptionId: current.jobDescriptionId,
        sourceResumeId: current.sourceResumeId,
        version: (latest?.version ?? current.version) + 1,
        contentJson: edited as unknown as object,
        analysisJson: current.analysisJson as object,
        changeLogJson: changes.slice(0, 40).map((c) => ({
          section: c.path,
          changeType: "reworded" as const,
          before: c.before,
          after: c.after,
          rationale: "Edited directly by you",
          keywordsTargeted: [],
        })),
        note: parsed.data.note ?? "Manual edit",
      },
      select: { id: true, version: true },
    });

    return NextResponse.json({
      saved: true,
      tailoredResumeId: row.id,
      version: row.version,
      changedFields: changes.length,
    });
  } catch (err) {
    return routeError(err);
  }
}
