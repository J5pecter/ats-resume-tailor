import "server-only";

import mammoth from "mammoth";

/**
 * Server-side text extraction (§Phase 2).
 * The uploaded binary is never persisted — text is extracted and the buffer discarded (§7).
 */

export type SourceKind = "pdf" | "docx" | "txt";

export interface ExtractionResult {
  text: string;
  kind: SourceKind;
  warnings: string[];
}

export class ExtractionError extends Error {}

const MAGIC: Record<SourceKind, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  docx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]], // PK zip container
  txt: [],
};

const ALLOWED_MIME: Record<SourceKind, string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ],
  txt: ["text/plain", "text/markdown", "application/octet-stream"],
};

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? 5);
  return (Number.isFinite(mb) && mb > 0 ? mb : 5) * 1024 * 1024;
}

function kindFromName(filename: string): SourceKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt" || ext === "md") return "txt";
  throw new ExtractionError(
    `Unsupported file type ".${ext}". Upload a .pdf, .docx or .txt file, or paste the text instead.`,
  );
}

function assertMagicBytes(buf: Buffer, kind: SourceKind): void {
  const signatures = MAGIC[kind];
  if (signatures.length === 0) return;
  const ok = signatures.some((sig) => sig.every((byte, i) => buf[i] === byte));
  if (!ok) {
    throw new ExtractionError(
      kind === "docx"
        ? "That file is named .docx but is not a Word document. Old .doc files must be re-saved as .docx, or paste the text instead."
        : "That file is named .pdf but is not a PDF. Re-export it, or paste the text instead.",
    );
  }
}

/**
 * Poor-extraction detection (§5.1 failure mode).
 * Two-column PDF resumes extract as interleaved fragments — the single most
 * common real-world input failure. We detect it and steer the user to paste.
 */
export function assessExtractionQuality(text: string, kind: SourceKind): string[] {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return warnings;

  const shortLines = lines.filter((l) => l.split(/\s+/).length < 4).length;
  const shortRatio = shortLines / lines.length;

  if (kind === "pdf" && shortRatio > 0.15) {
    warnings.push(
      `This PDF may not have parsed cleanly — ${Math.round(shortRatio * 100)}% of the extracted lines are fragments, which usually means a two-column or heavily styled layout. Check the text below carefully, and paste it manually if it reads as jumbled.`,
    );
  }

  const alphaRatio = (text.match(/[A-Za-z]/g)?.length ?? 0) / Math.max(text.length, 1);
  if (alphaRatio < 0.4) {
    warnings.push(
      "The extracted text contains very few letters. If this document is mostly images or tables, paste the text instead.",
    );
  }

  return warnings;
}

async function extractPdf(buf: Buffer): Promise<string> {
  // unpdf is imported lazily: it pulls in a sizeable pdf.js build.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function extractDocx(buf: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

export async function extractFromFile(file: File): Promise<ExtractionResult> {
  if (file.size === 0) throw new ExtractionError("That file is empty.");
  const limit = maxUploadBytes();
  if (file.size > limit) {
    throw new ExtractionError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${(limit / 1024 / 1024).toFixed(0)} MB.`,
    );
  }

  const kind = kindFromName(file.name);
  const declaredType = (file.type || "").toLowerCase();
  if (declaredType && !ALLOWED_MIME[kind].includes(declaredType)) {
    throw new ExtractionError(
      `The file's content type (${declaredType}) does not match its .${kind} extension.`,
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  assertMagicBytes(buf, kind);

  let text: string;
  try {
    if (kind === "pdf") text = await extractPdf(buf);
    else if (kind === "docx") text = await extractDocx(buf);
    else text = buf.toString("utf8");
  } catch (err) {
    throw new ExtractionError(
      `Could not read that ${kind.toUpperCase()} file (${(err as Error).message}). Paste the text instead.`,
    );
  }

  text = normaliseWhitespace(text);

  if (text.replace(/\s/g, "").length < 40) {
    throw new ExtractionError(
      kind === "pdf"
        ? "No selectable text was found in that PDF. It is most likely a scan or an image export, which has no text layer to read. Paste the text instead, or re-export the document from its original source."
        : "That file contained no readable text. Paste the text instead.",
    );
  }

  return { text, kind, warnings: assessExtractionQuality(text, kind) };
}

export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
