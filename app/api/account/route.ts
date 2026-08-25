import { NextResponse } from "next/server";
import { routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [jds, resumes, tailored] = await Promise.all([
      prisma.jobDescription.count({ where: { userId } }),
      prisma.sourceResume.count({ where: { userId } }),
      prisma.tailoredResume.count({ where: { userId } }),
    ]);
    return NextResponse.json({ counts: { jobDescriptions: jds, resumes, tailored } });
  } catch (err) {
    return routeError(err);
  }
}

/**
 * Delete my data (§7 Privacy). Every relation cascades from User, so removing
 * the user removes the job descriptions, resumes, tailored versions, analyses
 * and call logs with it.
 */
export async function DELETE() {
  try {
    const userId = await requireUserId();
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return routeError(err);
  }
}
