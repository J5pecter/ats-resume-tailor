import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedTailoredResume } from "@/lib/ownership";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { exportFilename } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  tailoredResumeId: z.string().min(1),
  format: z.enum(["docx", "pdf"]),
});

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** Exports are always generated server-side, behind a session and ownership check (§6.4). */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Choose a document and a format.");

    const row = await ownedTailoredResume(userId, parsed.data.tailoredResumeId);
    const resume = ResumeDocSchema.parse(row.contentJson);

    const jd = await prisma.jobDescription.findFirst({
      where: { id: row.jobDescriptionId, userId },
      select: { title: true },
    });
    const roleTitle = jd?.title ?? "Resume";

    const buffer =
      parsed.data.format === "docx"
        ? await (await import("@/lib/export/docx")).buildDocx(resume, roleTitle)
        : await (await import("@/lib/export/pdf")).buildPdf(resume, roleTitle);

    const filename = exportFilename(resume.contact.fullName, roleTitle, parsed.data.format);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": MIME[parsed.data.format],
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(buffer.length),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return routeError(err);
  }
}
