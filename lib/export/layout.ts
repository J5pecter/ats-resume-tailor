import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * The shared document model (§6, and §10 point 3 — "DOCX and PDF drift apart
 * if built independently").
 *
 * Neither exporter reads ResumeDoc directly. Both walk this block list, so a
 * change to section order, heading text or date formatting lands in both
 * formats at once and they cannot diverge.
 */

export type Block =
  | { kind: "name"; text: string }
  | { kind: "headline"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "section"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "skills"; category: string; skills: string }
  | { kind: "roleHeader"; left: string; right: string }
  | { kind: "roleMeta"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "labelled"; label: string; value: string };

/** Headings come from the standard ATS set only (§6.1). */
export const HEADINGS = {
  summary: "PROFESSIONAL SUMMARY",
  skills: "CORE SKILLS",
  experience: "PROFESSIONAL EXPERIENCE",
  projects: "PROJECTS",
  education: "EDUCATION",
  certifications: "CERTIFICATIONS",
  additional: "ADDITIONAL INFORMATION",
} as const;

/**
 * Type sizes in points. DOCX halves these into half-points; PDF uses them directly.
 * Arial (DOCX) and Helvetica (PDF) are metrically equivalent, which is what
 * keeps the two documents visually the same without shipping font binaries.
 */
export const TYPE = {
  name: 17,
  headline: 10.5,
  contact: 9.5,
  section: 11,
  body: 10,
  meta: 9.5,
} as const;

/**
 * Vertical rhythm, in points. Kept here rather than in each renderer so the
 * DOCX and the PDF cannot drift apart on spacing the way they would if each
 * carried its own numbers.
 */
export const SPACE = {
  // Not merely cosmetic: below roughly 3pt, pdf.js merges the name and the
  // headline into one run when extracting, so an ATS reads "VYASInternal
  // Auditor" and loses the surname. The DOCX/PDF agreement test catches this.
  afterName: 3.5,
  afterHeadline: 3.5,
  afterContact: 10,
  beforeSection: 10.5,
  afterSection: 5,
  betweenParagraphs: 4,
  betweenSkillLines: 3,
  beforeRole: 7.5,
  afterRoleHeader: 1.5,
  afterRoleMeta: 2,
  betweenBullets: 3,
} as const;

/** Line spacing at full density. Compressed proportionally when space runs short. */
export const LINE_HEIGHT = 1.3;

/** Usable text width in characters, at body size across the printable area. */
const CHARS_PER_LINE = 100;

/**
 * Lines a page holds at full density. Calibrated against a rendered PDF rather
 * than derived: at LINE_HEIGHT 1.3 with the SPACE scale below, a page fits 40.
 */
const LINES_PER_PAGE = 40;

/**
 * How empty a final page has to be before it is worth compressing to avoid.
 * Resumes are conventionally one full page or two — a last page under half
 * full reads as unfinished, and is worth crowding the rest to reclaim.
 */
const ORPHAN_MARGIN = 0.5;

function wrapped(text: string, width = CHARS_PER_LINE): number {
  return Math.max(1, Math.ceil(text.length / width));
}

export function estimateLines(blocks: Block[]): number {
  let lines = 0;
  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
        lines += wrapped(block.text);
        break;
      case "bullet":
        lines += wrapped(block.text, CHARS_PER_LINE - 4);
        break;
      case "skills":
        lines += wrapped(`${block.category}: ${block.skills}`);
        break;
      case "labelled":
        lines += wrapped(`${block.label}: ${block.value}`);
        break;
      default:
        // name, headline, contact, section heading, role header, role meta
        lines += 1;
    }
  }
  return lines;
}

/**
 * How tightly to set this particular document.
 *
 * A fixed spacing scale cannot serve both a one-year CV and a fifteen-year one:
 * set it comfortably and the junior resume spills six lines onto a second page,
 * set it tight enough to prevent that and every resume reads cramped.
 *
 * The rule is only about page boundaries. Compress when the content sits just
 * over one — those last few lines are worth crowding to avoid an almost-empty
 * extra sheet. Everywhere else, stay comfortable: tightening a document that
 * already fits buys nothing and costs legibility.
 */
export function densityScale(blocks: Block[]): number {
  const forced = Number(process.env.EXPORT_DENSITY_SCALE);
  if (Number.isFinite(forced) && forced > 0) return forced;

  const estimated = estimateLines(blocks);
  const overflow = estimated / LINES_PER_PAGE;
  const past = overflow - Math.floor(overflow);

  // Comfortably inside a page, or far enough past one that the final page will
  // be properly filled either way.
  if (overflow <= 1 || past === 0 || past > ORPHAN_MARGIN) return 1;

  // Spilling onto a page that would sit half empty. 0.68 is measured, not
  // guessed: swept against a real one-page-plus-six-lines resume, 0.7 was the
  // loosest setting that reclaimed the page and 0.75 was not enough. Sitting
  // just inside that leaves margin for documents shaped slightly differently.
  return 0.68;
}

/** SPACE scaled for this particular document. */
export function spacingFor(blocks: Block[]): Record<keyof typeof SPACE, number> {
  const scale = densityScale(blocks);
  const out = {} as Record<keyof typeof SPACE, number>;
  for (const key of Object.keys(SPACE) as (keyof typeof SPACE)[]) {
    // Never below the 3pt floor that keeps the name from fusing into the
    // headline when a PDF text layer is extracted.
    const scaled = SPACE[key] * scale;
    out[key] = key === "afterName" || key === "afterHeadline" ? Math.max(3, scaled) : scaled;
  }
  return out;
}

/** Line height for this document, compressed with the same scale but never below 1.15. */
export function lineHeightFor(blocks: Block[]): number {
  return Math.max(1.15, LINE_HEIGHT * (0.85 + 0.15 * densityScale(blocks)));
}

/** 0.6in is the tightest the ATS rules allow, and buys a few more lines of content. */
export const MARGIN_INCHES = 0.65;

export function formatDateRange(start: string, end: string): string {
  const s = start.trim();
  const e = end.trim();
  if (!s && !e) return "";
  if (!s) return e;
  if (!e) return s;
  return `${s} \u2013 ${e}`;
}

function contactLine(resume: ResumeDoc): string {
  return [
    resume.contact.location,
    resume.contact.phone,
    resume.contact.email,
    resume.contact.linkedin,
    resume.contact.portfolio,
  ]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join("  |  ");
}

export function buildBlocks(resume: ResumeDoc): Block[] {
  const blocks: Block[] = [];

  // Contact block sits in the body, never a header/footer — ATS parsers
  // frequently skip headers (§6.1).
  blocks.push({ kind: "name", text: resume.contact.fullName });
  if (resume.contact.headline.trim()) {
    blocks.push({ kind: "headline", text: resume.contact.headline.trim() });
  }
  const contact = contactLine(resume);
  if (contact) blocks.push({ kind: "contact", text: contact });

  if (resume.summary.trim()) {
    blocks.push({ kind: "section", text: HEADINGS.summary });
    blocks.push({ kind: "paragraph", text: resume.summary.trim() });
  }

  if (resume.coreSkills.length) {
    blocks.push({ kind: "section", text: HEADINGS.skills });
    for (const group of resume.coreSkills) {
      const skills = group.skills.map((s) => s.name.trim()).filter(Boolean).join(", ");
      if (skills) blocks.push({ kind: "skills", category: group.category, skills });
    }
  }

  if (resume.experience.length) {
    blocks.push({ kind: "section", text: HEADINGS.experience });
    for (const exp of resume.experience) {
      blocks.push({
        kind: "roleHeader",
        left: [exp.company, exp.role].filter(Boolean).join(" \u2014 "),
        right: formatDateRange(exp.startDate, exp.endDate),
      });
      const meta = [exp.location, exp.context].map((m) => (m ?? "").trim()).filter(Boolean);
      if (meta.length) blocks.push({ kind: "roleMeta", text: meta.join("  |  ") });
      for (const bullet of exp.bullets) {
        if (bullet.text.trim()) blocks.push({ kind: "bullet", text: bullet.text.trim() });
      }
    }
  }

  if (resume.projects?.length) {
    blocks.push({ kind: "section", text: HEADINGS.projects });
    for (const project of resume.projects) {
      const stack = project.stack?.filter(Boolean).join(", ");
      blocks.push({
        kind: "roleHeader",
        left: project.name,
        right: project.link?.trim() ?? "",
      });
      const detail = [project.description, stack ? `Stack: ${stack}` : ""]
        .map((d) => d.trim())
        .filter(Boolean)
        .join(" ");
      if (detail) blocks.push({ kind: "bullet", text: detail });
    }
  }

  if (resume.education.length) {
    blocks.push({ kind: "section", text: HEADINGS.education });
    for (const edu of resume.education) {
      // Institution on the bold line: it is the anchor a human scans for and
      // the token an ATS matches against, so it should not be demoted.
      blocks.push({ kind: "roleHeader", left: edu.institution, right: edu.endDate });
      const meta = [[edu.degree, edu.field].filter(Boolean).join(", "), edu.score]
        .map((m) => (m ?? "").trim())
        .filter(Boolean)
        .join("  |  ");
      if (meta) blocks.push({ kind: "roleMeta", text: meta });
    }
  }

  if (resume.certifications?.length) {
    blocks.push({ kind: "section", text: HEADINGS.certifications });
    // One bullet per certification costs a line each and pushes short resumes
    // onto a second page for no benefit. Run them together instead: an ATS
    // reads the delimited list just as well, and a reader scans it faster.
    const certs = resume.certifications
      .map((cert) => {
        const detail = [cert.issuer, cert.date].map((d) => (d ?? "").trim()).filter(Boolean);
        return detail.length ? `${cert.name} (${detail.join(", ")})` : cert.name;
      })
      .filter(Boolean);
    if (certs.length) blocks.push({ kind: "paragraph", text: certs.join("  •  ") });
  }

  if (resume.additional?.length) {
    blocks.push({ kind: "section", text: HEADINGS.additional });
    for (const item of resume.additional) {
      if (item.value.trim()) {
        blocks.push({ kind: "labelled", label: item.label, value: item.value.trim() });
      }
    }
  }

  return blocks;
}
