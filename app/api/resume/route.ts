import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { contentHash } from "@/lib/hash";
import { callStructured } from "@/lib/llm/client";
import { resumeParserPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { ResumeDocSchema, type ResumeDoc } from "@/lib/schema/resume";
import { normaliseWhitespace } from "@/lib/extract/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  rawText: z.string().trim().min(120, "That resume looks too short to parse."),
  label: z.string().trim().max(160).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await prisma.sourceResume.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, createdAt: true },
      take: 25,
    });
    return NextResponse.json({ resumes: rows });
  } catch (err) {
    return routeError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Provide a resume.");
    }

    const rawText = normaliseWhitespace(parsed.data.rawText);
    const hash = contentHash(rawText);

    const cached = await prisma.sourceResume.findFirst({
      where: { userId, contentHash: hash },
      orderBy: { createdAt: "desc" },
    });
    if (cached) {
      return NextResponse.json({
        id: cached.id,
        label: cached.label,
        resume: cached.parsedJson as unknown as ResumeDoc,
        cached: true,
      });
    }

    const { data: resume } = await callStructured({
      ...resumeParserPrompt(rawText),
      userId,
    });

    const label = parsed.data.label?.trim() || resume.contact.fullName || "My resume";

    const row = await prisma.sourceResume.create({
      data: {
        userId,
        label,
        rawText,
        contentHash: hash,
        parsedJson: ResumeDocSchema.parse(resume),
      },
      select: { id: true, label: true },
    });

    return NextResponse.json({ id: row.id, label: row.label, resume, cached: false });
  } catch (err) {
    return routeError(err);
  }
}
