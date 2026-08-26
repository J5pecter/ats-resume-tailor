import "server-only";

import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ResumeDoc } from "@/lib/schema/resume";
import { buildBlocks, MARGIN_INCHES, SPACE, TYPE, type Block } from "./layout";

/**
 * PDF export (§6.3). Mirrors the DOCX layout block for block — both walk the
 * same list from lib/export/layout.ts.
 *
 * Font choice: @react-pdf/renderer fails *silently* when a registered font
 * cannot be fetched, falling back to something that breaks the layout (§10
 * point 4). Helvetica is one of the 14 fonts built into the PDF format itself,
 * so there is no fetch to fail, and it is metrically equivalent to the Arial
 * used in the DOCX. Naming it explicitly on every style means we never rely on
 * a default.
 */

const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

// Resume text is not prose; hyphenating it mid-word hurts both readability and
// ATS token matching.
Font.registerHyphenationCallback((word) => [word]);

const PT_PER_INCH = 72;
const MARGIN = MARGIN_INCHES * PT_PER_INCH;

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    paddingBottom: MARGIN,
    paddingHorizontal: MARGIN,
    fontFamily: FONT,
    fontSize: TYPE.body,
    color: "#000000",
    lineHeight: 1.35,
  },
  name: {
    fontFamily: FONT_BOLD,
    fontSize: TYPE.name,
    textAlign: "center",
    letterSpacing: 0.6,
    marginBottom: SPACE.afterName,
  },
  headline: {
    fontSize: TYPE.headline,
    textAlign: "center",
    color: "#222222",
    marginBottom: SPACE.afterHeadline,
  },
  contact: {
    fontSize: TYPE.contact,
    textAlign: "center",
    color: "#333333",
    marginBottom: SPACE.afterContact,
  },
  section: {
    fontFamily: FONT_BOLD,
    fontSize: TYPE.section,
    letterSpacing: 0.4,
    marginTop: SPACE.beforeSection,
    marginBottom: SPACE.afterSection,
    paddingBottom: 2.5,
    borderBottomWidth: 0.75,
    borderBottomColor: "#999999",
    borderBottomStyle: "solid",
  },
  paragraph: { fontSize: TYPE.body, marginBottom: SPACE.betweenParagraphs },
  skillsRow: { flexDirection: "row", marginBottom: SPACE.betweenSkillLines },
  skillsCategory: { fontFamily: FONT_BOLD, fontSize: TYPE.body },
  skillsValue: { fontSize: TYPE.body, flex: 1 },
  roleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: SPACE.beforeRole,
    marginBottom: SPACE.afterRoleHeader,
  },
  roleLeft: { fontFamily: FONT_BOLD, fontSize: TYPE.body, flex: 1, paddingRight: 8 },
  roleRight: { fontSize: TYPE.meta },
  roleMeta: { fontSize: TYPE.meta, color: "#444444", marginBottom: SPACE.afterRoleMeta },
  // Hanging indent: the glyph column is fixed, so wrapped lines align under the
  // text rather than under the bullet.
  bulletRow: { flexDirection: "row", marginBottom: SPACE.betweenBullets, paddingLeft: 2 },
  bulletGlyph: { width: 10, fontSize: TYPE.body },
  bulletText: { flex: 1, fontSize: TYPE.body },
  labelledRow: { flexDirection: "row", marginBottom: SPACE.betweenBullets },
  labelledLabel: { fontFamily: FONT_BOLD, fontSize: TYPE.body },
  labelledValue: { fontSize: TYPE.body, flex: 1 },
});

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "name":
      return <Text style={styles.name}>{block.text}</Text>;
    case "headline":
      return <Text style={styles.headline}>{block.text}</Text>;
    case "contact":
      return <Text style={styles.contact}>{block.text}</Text>;
    case "section":
      return <Text style={styles.section}>{block.text}</Text>;
    case "paragraph":
      return <Text style={styles.paragraph}>{block.text}</Text>;
    case "skills":
      return (
        <View style={styles.skillsRow} wrap={false}>
          <Text style={styles.skillsCategory}>{block.category}: </Text>
          <Text style={styles.skillsValue}>{block.skills}</Text>
        </View>
      );
    case "roleHeader":
      return (
        <View style={styles.roleHeader} wrap={false}>
          <Text style={styles.roleLeft}>{block.left}</Text>
          {block.right ? <Text style={styles.roleRight}>{block.right}</Text> : null}
        </View>
      );
    case "roleMeta":
      return <Text style={styles.roleMeta}>{block.text}</Text>;
    case "bullet":
      return (
        <View style={styles.bulletRow}>
          {/* Standard bullet character, never an image or custom glyph. */}
          <Text style={styles.bulletGlyph}>{"\u2022"}</Text>
          <Text style={styles.bulletText}>{block.text}</Text>
        </View>
      );
    case "labelled":
      return (
        <View style={styles.labelledRow}>
          <Text style={styles.labelledLabel}>{block.label}: </Text>
          <Text style={styles.labelledValue}>{block.value}</Text>
        </View>
      );
  }
}

/**
 * Groups each role header with its first two bullets inside a non-breaking
 * view, so a heading can never orphan at the foot of a page (§6.3).
 */
function groupForPaging(blocks: Block[]): Block[][] {
  const groups: Block[][] = [];
  let current: Block[] = [];

  for (const block of blocks) {
    if (block.kind === "roleHeader" || block.kind === "section") {
      if (current.length) groups.push(current);
      current = [block];
      continue;
    }
    current.push(block);
  }
  if (current.length) groups.push(current);
  return groups;
}

export function ResumePdf({
  resume,
  roleTitle,
}: {
  resume: ResumeDoc;
  roleTitle: string;
}) {
  const groups = groupForPaging(buildBlocks(resume));

  return (
    <Document
      title={`${resume.contact.fullName} — ${roleTitle}`.trim()}
      author={resume.contact.fullName || "ATS Resume Tailor"}
      subject={`Resume tailored for ${roleTitle}`}
      creator="ATS Resume Tailor"
      producer="ATS Resume Tailor"
    >
      <Page size="A4" style={styles.page} wrap>
        {groups.map((group, gi) => {
          // Keep a heading with the two blocks that follow it; let the rest flow.
          const anchor = group.slice(0, 3);
          const rest = group.slice(3);
          return (
            <View key={gi}>
              <View wrap={false}>
                {anchor.map((block, bi) => (
                  <BlockView key={bi} block={block} />
                ))}
              </View>
              {rest.map((block, bi) => (
                <BlockView key={`r${bi}`} block={block} />
              ))}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

export async function buildPdf(resume: ResumeDoc, roleTitle: string): Promise<Buffer> {
  return renderToBuffer(<ResumePdf resume={resume} roleTitle={roleTitle} />);
}
