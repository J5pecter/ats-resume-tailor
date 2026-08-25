import { createHash } from "node:crypto";

/** Content hash used to cache parse results (§7 Cost). */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}
