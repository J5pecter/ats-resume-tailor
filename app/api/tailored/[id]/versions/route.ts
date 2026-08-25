import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, NotFoundError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedTailoredResume } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Every version of the document lineage this id belongs to. */
export async function GET(_req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const current = await ownedTailoredResume(userId, id);

    const versions = await prisma.tailoredResume.findMany({
      where: {
        userId,
        jobDescriptionId: current.jobDescriptionId,
        sourceResumeId: current.sourceResumeId,
      },
      orderBy: { version: "desc" },
      select: { id: true, version: true, note: true, createdAt: true },
    });

    return NextResponse.json({ versions, currentId: current.id, currentVersion: current.version });
  } catch (err) {
    return routeError(err);
  }
}

const RollbackBody = z.object({ restoreId: z.string().min(1) });

/**
 * Rollback. LLM refinements sometimes make things worse, so the user needs an
 * undo — and because rows are immutable, restoring means writing the old
 * content forward as a new version rather than deleting anything (§3).
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const current = await ownedTailoredResume(userId, id);

    const parsed = RollbackBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Choose a version to restore.");

    const target = await prisma.tailoredResume.findFirst({
      where: {
        id: parsed.data.restoreId,
        userId,
        jobDescriptionId: current.jobDescriptionId,
        sourceResumeId: current.sourceResumeId,
      },
    });
    if (!target) throw new NotFoundError("That version");

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
        contentJson: target.contentJson as object,
        analysisJson: target.analysisJson as object,
        changeLogJson: target.changeLogJson as object,
        note: `Restored from v${target.version}`,
      },
      select: { id: true, version: true },
    });

    return NextResponse.json({
      tailoredResumeId: row.id,
      version: row.version,
      resume: target.contentJson,
      restoredFrom: target.version,
    });
  } catch (err) {
    return routeError(err);
  }
}
