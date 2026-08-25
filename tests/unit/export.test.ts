import { describe, expect, it } from "vitest";
import { buildDocx } from "@/lib/export/docx";
import { buildPdf } from "@/lib/export/pdf";
import { HEADINGS, buildBlocks, formatDateRange } from "@/lib/export/layout";
import { SAMPLE_RESUME } from "../fixtures/resume";

const ROLE = "Senior Product Manager";

/** Everything an ATS has to be able to find in the generated file. */
const MUST_APPEAR = [
  SAMPLE_RESUME.contact.fullName,
  ...SAMPLE_RESUME.experience.map((e) => e.company),
  HEADINGS.summary,
  HEADINGS.skills,
  HEADINGS.experience,
  HEADINGS.education,
  HEADINGS.certifications,
];

async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Word documents are zipped XML; the text lives in word/document.xml. */
async function docxText(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

describe("shared layout model", () => {
  it("emits the standard ATS section headings in a fixed order", () => {
    const headings = buildBlocks(SAMPLE_RESUME)
      .filter((b) => b.kind === "section")
      .map((b) => (b as { text: string }).text);

    expect(headings).toEqual([
      HEADINGS.summary,
      HEADINGS.skills,
      HEADINGS.experience,
      HEADINGS.education,
      HEADINGS.certifications,
      HEADINGS.additional,
    ]);
  });

  it("formats date ranges consistently and keeps Present", () => {
    expect(formatDateRange("Apr 2023", "Present")).toBe("Apr 2023 \u2013 Present");
    expect(formatDateRange("Apr 2023", "")).toBe("Apr 2023");
  });

  it("puts contact details in the body, not a header block", () => {
    const contact = buildBlocks(SAMPLE_RESUME).find((b) => b.kind === "contact");
    expect(contact).toBeDefined();
    expect((contact as { text: string }).text).toContain(SAMPLE_RESUME.contact.email);
  });
});

describe("DOCX export", () => {
  it("produces a real .docx package", async () => {
    const buffer = await buildDocx(SAMPLE_RESUME, ROLE);
    expect(buffer.length).toBeGreaterThan(2000);
    // PK zip signature — Word will not open it otherwise.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("contains the name, every company and every section heading", async () => {
    const text = await docxText(await buildDocx(SAMPLE_RESUME, ROLE));
    for (const needle of MUST_APPEAR) {
      expect(text, `DOCX is missing "${needle}"`).toContain(needle);
    }
  });

  it("keeps every bullet", async () => {
    const text = await docxText(await buildDocx(SAMPLE_RESUME, ROLE));
    for (const exp of SAMPLE_RESUME.experience) {
      for (const bullet of exp.bullets) {
        expect(text).toContain(bullet.text.slice(0, 40));
      }
    }
  });
});

describe("PDF export", () => {
  it("produces a real PDF", async () => {
    const buffer = await buildPdf(SAMPLE_RESUME, ROLE);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  /**
   * §6.3: if text extraction fails here, the ATS will fail too. This is the
   * check that catches a silent font fallback rendering the page as outlines.
   */
  it("has a selectable text layer containing the name, companies and headings", async () => {
    const text = await pdfText(await buildPdf(SAMPLE_RESUME, ROLE));
    for (const needle of MUST_APPEAR) {
      expect(text, `PDF text layer is missing "${needle}"`).toContain(needle);
    }
  });

  it("keeps every bullet in the extractable text", async () => {
    const text = await pdfText(await buildPdf(SAMPLE_RESUME, ROLE));
    const flattened = text.replace(/\s+/g, " ");
    for (const exp of SAMPLE_RESUME.experience) {
      for (const bullet of exp.bullets) {
        expect(flattened).toContain(bullet.text.slice(0, 40).replace(/\s+/g, " "));
      }
    }
  });
});

describe("DOCX and PDF agree", () => {
  it("carry the same words in the same order", async () => {
    const [docx, pdf] = await Promise.all([
      docxText(await buildDocx(SAMPLE_RESUME, ROLE)),
      pdfText(await buildPdf(SAMPLE_RESUME, ROLE)),
    ]);

    const words = (value: string) =>
      value
        .replace(/[\u2022]/g, " ")
        .split(/\s+/)
        .map((w) => w.replace(/[^\w%+.@/-]/g, ""))
        .filter((w) => w.length > 2)
        .map((w) => w.toLowerCase());

    expect(words(pdf)).toEqual(words(docx));
  });
});
