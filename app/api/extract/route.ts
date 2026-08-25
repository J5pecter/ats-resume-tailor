import { NextResponse } from "next/server";
import { BadRequestError, routeError } from "@/lib/api";
import { requireUserId } from "@/lib/auth";
import { extractFromFile } from "@/lib/extract/text";

export const runtime = "nodejs";

/**
 * Upload -> plain text. The binary is never persisted: it is read into memory,
 * converted to text, and dropped when the request ends (§7 Security).
 */
export async function POST(req: Request) {
  try {
    await requireUserId();

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new BadRequestError("No file was uploaded.");

    const result = await extractFromFile(file);
    return NextResponse.json({
      text: result.text,
      kind: result.kind,
      warnings: result.warnings,
      filename: file.name,
    });
  } catch (err) {
    return routeError(err);
  }
}
