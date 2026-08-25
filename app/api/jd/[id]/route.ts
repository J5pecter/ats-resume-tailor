import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedJobDescription } from "@/lib/ownership";
import { JDProfileSchema } from "@/lib/schema/jd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  profile: JDProfileSchema,
  title: z.string().trim().min(1).max(160).optional(),
});

/**
 * Lets the user correct the extracted profile before it drives anything
 * downstream (§1.2 — "User confirms or edits before proceeding").
 * Editing the profile invalidates any gap analysis derived from it.
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await ownedJobDescription(userId, id);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "That edit could not be saved.");
    }

    const row = await prisma.jobDescription.update({
      where: { id },
      data: {
        parsedJson: parsed.data.profile,
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
      },
      select: { id: true, title: true, parsedJson: true },
    });

    await prisma.analysis.deleteMany({ where: { userId, jobDescriptionId: id } });

    return NextResponse.json({ id: row.id, title: row.title, profile: row.parsedJson });
  } catch (err) {
    return routeError(err);
  }
}
