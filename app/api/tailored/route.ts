import { NextResponse } from "next/server";
import { routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the user has tailored, so they can go back to any of it.
 *
 * The dashboard restores the most recent lineage on load, which is right for
 * the common case and useless for the others: someone applying to four roles
 * had three of them permanently out of reach.
 *
 * Rows are versions, not documents. A refinement, a manual edit and a rollback
 * all write version+1 into the same lineage — (jobDescriptionId,
 * sourceResumeId) — so listing rows directly would show one job four times.
 * This groups by lineage and reports the newest version of each, with a count
 * so the history is visible without opening it.
 */
const MAX_ROWS = 300;

export async function GET() {
  try {
    const userId = await requireUserId();

    const rows = await prisma.tailoredResume.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take: MAX_ROWS,
      select: {
        id: true,
        version: true,
        note: true,
        createdAt: true,
        jobDescriptionId: true,
        sourceResumeId: true,
        jd: { select: { title: true } },
        source: { select: { label: true } },
      },
    });

    // Grouped here rather than in SQL: Prisma's `distinct` is pushed to the
    // database on some connectors and applied in memory on others, and a
    // library that silently behaves differently on SQLite and Postgres is a
    // bug waiting for the next deploy.
    const byLineage = new Map<
      string,
      {
        id: string;
        version: number;
        versionCount: number;
        note: string | null;
        jobTitle: string;
        resumeLabel: string;
        jobDescriptionId: string;
        sourceResumeId: string;
        updatedAt: Date;
      }
    >();

    for (const row of rows) {
      const key = `${row.jobDescriptionId}:${row.sourceResumeId}`;
      const seen = byLineage.get(key);
      if (!seen) {
        byLineage.set(key, {
          id: row.id,
          version: row.version,
          versionCount: 1,
          note: row.note,
          jobTitle: row.jd?.title ?? "Untitled role",
          resumeLabel: row.source?.label ?? "Resume",
          jobDescriptionId: row.jobDescriptionId,
          sourceResumeId: row.sourceResumeId,
          updatedAt: row.createdAt,
        });
        continue;
      }
      seen.versionCount++;
      // Ordered by createdAt, but version is what identifies the newest: a
      // rollback writes older content forward, so the latest row is the one to
      // open even when its content is old.
      if (row.version > seen.version) {
        seen.id = row.id;
        seen.version = row.version;
        seen.note = row.note;
        seen.updatedAt = row.createdAt;
      }
    }

    return NextResponse.json({
      tailored: [...byLineage.values()].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      ),
      truncated: rows.length === MAX_ROWS,
    });
  } catch (err) {
    return routeError(err);
  }
}
