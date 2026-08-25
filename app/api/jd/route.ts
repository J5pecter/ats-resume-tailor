import { NextResponse } from "next/server";
import { z } from "zod";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { contentHash } from "@/lib/hash";
import { callStructured } from "@/lib/llm/client";
import { jdParserPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { JDProfileSchema, type JDProfile } from "@/lib/schema/jd";
import { normaliseWhitespace } from "@/lib/extract/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  rawText: z.string().trim().min(80, "That job description looks too short to analyse."),
  title: z.string().trim().max(160).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await prisma.jobDescription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, parsedJson: true },
      take: 25,
    });
    return NextResponse.json({ jobDescriptions: rows });
  } catch (err) {
    return routeError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? "Provide a job description.");
    }

    const rawText = normaliseWhitespace(parsed.data.rawText);
    const hash = contentHash(rawText);

    // Users re-run generation far more often than they change their inputs, so
    // an identical JD reuses the previous parse instead of paying for it again (§7 Cost).
    const cached = await prisma.jobDescription.findFirst({
      where: { userId, contentHash: hash },
      orderBy: { createdAt: "desc" },
    });
    if (cached) {
      return NextResponse.json({
        id: cached.id,
        title: cached.title,
        profile: cached.parsedJson as unknown as JDProfile,
        cached: true,
      });
    }

    const { data: profile } = await callStructured({
      ...jdParserPrompt(rawText),
      userId,
    });

    const title =
      parsed.data.title?.trim() ||
      [profile.roleTitle, profile.company].filter(Boolean).join(" — ") ||
      "Untitled role";

    const row = await prisma.jobDescription.create({
      data: {
        userId,
        title,
        rawText,
        contentHash: hash,
        parsedJson: JDProfileSchema.parse(profile),
      },
      select: { id: true, title: true },
    });

    return NextResponse.json({ id: row.id, title: row.title, profile, cached: false });
  } catch (err) {
    return routeError(err);
  }
}
