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
  afterName: 2,
  afterHeadline: 2,
  afterContact: 11,
  beforeSection: 11,
  afterSection: 5,
  betweenParagraphs: 4,
  betweenSkillLines: 2.5,
  beforeRole: 8,
  afterRoleHeader: 1,
  afterRoleMeta: 2,
  betweenBullets: 2.5,
} as const;

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
    for (const cert of resume.certifications) {
      const detail = [cert.issuer, cert.date].map((d) => (d ?? "").trim()).filter(Boolean);
      blocks.push({
        kind: "bullet",
        text: detail.length ? `${cert.name} (${detail.join(", ")})` : cert.name,
      });
    }
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
