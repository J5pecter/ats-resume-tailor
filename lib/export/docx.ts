import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeDoc } from "@/lib/schema/resume";
import { buildBlocks, MARGIN_INCHES, TYPE, type Block } from "./layout";

/**
 * DOCX export (§6.2).
 *
 * Single column, no tables, no text boxes, no graphics. Real heading styles so
 * the outline is machine-readable, right-aligned dates via a tab stop rather
 * than a table, and a paragraph border under section headings rather than a
 * drawn line.
 */

const FONT = "Arial";
const BULLET_REF = "resume-bullets";

/** docx sizes are half-points; margins are twips (1 inch = 1440). */
const hp = (points: number) => Math.round(points * 2);
const MARGIN_TWIPS = Math.round(MARGIN_INCHES * 1440);

function run(text: string, opts: { bold?: boolean; size: number; color?: string } = { size: TYPE.body }) {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    size: hp(opts.size),
    color: opts.color ?? "000000",
    font: FONT,
  });
}

function renderBlock(block: Block): Paragraph {
  switch (block.kind) {
    case "name":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [run(block.text, { bold: true, size: TYPE.name })],
      });

    case "headline":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [run(block.text, { size: TYPE.headline })],
      });

    case "contact":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [run(block.text, { size: TYPE.contact, color: "333333" })],
      });

    case "section":
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 220, after: 90 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 },
        },
        children: [run(block.text, { bold: true, size: TYPE.section })],
      });

    case "paragraph":
      return new Paragraph({
        spacing: { after: 80, line: 260 },
        children: [run(block.text, { size: TYPE.body })],
      });

    case "skills":
      return new Paragraph({
        spacing: { after: 50, line: 260 },
        children: [
          run(`${block.category}: `, { bold: true, size: TYPE.body }),
          run(block.skills, { size: TYPE.body }),
        ],
      });

    case "roleHeader":
      return new Paragraph({
        // A right tab stop, not a table — tables break ATS parsers (§6.1).
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 130, after: 20 },
        keepNext: true,
        children: [
          run(block.left, { bold: true, size: TYPE.body }),
          run(`\t${block.right}`, { size: TYPE.meta }),
        ],
      });

    case "roleMeta":
      return new Paragraph({
        spacing: { after: 40 },
        keepNext: true,
        children: [run(block.text, { size: TYPE.meta, color: "444444" })],
      });

    case "bullet":
      return new Paragraph({
        numbering: { reference: BULLET_REF, level: 0 },
        spacing: { after: 40, line: 260 },
        children: [run(block.text, { size: TYPE.body })],
      });

    case "labelled":
      return new Paragraph({
        spacing: { after: 40, line: 260 },
        children: [
          run(`${block.label}: `, { bold: true, size: TYPE.body }),
          run(block.value, { size: TYPE.body }),
        ],
      });
  }
}

export async function buildDocx(resume: ResumeDoc, roleTitle: string): Promise<Buffer> {
  const doc = new Document({
    creator: resume.contact.fullName || "ATS Resume Tailor",
    title: `${resume.contact.fullName} — ${roleTitle}`.trim(),
    description: `Resume tailored for ${roleTitle}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: hp(TYPE.body), color: "000000" } },
        heading1: { run: { font: FONT, size: hp(TYPE.section), bold: true, color: "000000" } },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              // Standard bullet only — never a custom glyph or an image (§6.1).
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN_TWIPS,
              bottom: MARGIN_TWIPS,
              left: MARGIN_TWIPS,
              right: MARGIN_TWIPS,
            },
          },
        },
        children: buildBlocks(resume).map(renderBlock),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
