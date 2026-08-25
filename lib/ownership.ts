import "server-only";

import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api";

/**
 * Every data route checks session AND row ownership (§7).
 * An IDOR here would leak somebody's full employment history, so these helpers
 * always filter on userId rather than fetching then comparing.
 */

export async function ownedJobDescription(userId: string, id: string) {
  const row = await prisma.jobDescription.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError("That job description");
  return row;
}

export async function ownedSourceResume(userId: string, id: string) {
  const row = await prisma.sourceResume.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError("That resume");
  return row;
}

export async function ownedTailoredResume(userId: string, id: string) {
  const row = await prisma.tailoredResume.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError("That tailored resume");
  return row;
}
