import { NextResponse } from "next/server";
import { routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { ownedSourceResume } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * One stored resume, so a returning user can reuse it instead of uploading the
 * same CV again.
 *
 * The list endpoint deliberately returns labels only — a page of parsed
 * documents to render eight buttons is a lot of resume content over the wire
 * for a click that usually never happens. This fetches the one that was
 * actually chosen.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const row = await ownedSourceResume(userId, id);

    return NextResponse.json({
      id: row.id,
      label: row.label,
      resume: row.parsedJson,
      createdAt: row.createdAt,
    });
  } catch (err) {
    return routeError(err);
  }
}
