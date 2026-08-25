import { describe, expect, it } from "vitest";
import { detectDrift, diffDocuments } from "@/lib/validate/drift";
import { SAMPLE_RESUME } from "../fixtures/resume";
import type { ResumeDoc } from "@/lib/schema/resume";

function edit(mutate: (draft: ResumeDoc) => void): ResumeDoc {
  const draft = structuredClone(SAMPLE_RESUME);
  mutate(draft);
  return draft;
}

describe("drift detection", () => {
  it("reports no changes for an identical document", () => {
    expect(diffDocuments(SAMPLE_RESUME, structuredClone(SAMPLE_RESUME))).toHaveLength(0);
  });

  it("ignores pure whitespace reflow", () => {
    const after = edit((d) => {
      d.summary = SAMPLE_RESUME.summary.replace(/ /g, "  ");
    });
    expect(diffDocuments(SAMPLE_RESUME, after)).toHaveLength(0);
  });

  it("accepts a declared, single-field change", () => {
    const after = edit((d) => {
      d.summary = "Shorter summary.";
    });
    const report = detectDrift(SAMPLE_RESUME, after, [
      { section: "summary", before: SAMPLE_RESUME.summary, after: "Shorter summary." },
    ]);
    expect(report.hasDrift).toBe(false);
    expect(report.changed).toHaveLength(1);
  });

  it("rejects a change the model did not declare", () => {
    const after = edit((d) => {
      d.summary = "Shorter summary.";
      // Silent drift: the model also retitled a role nobody asked it to touch.
      d.experience[1].role = "Lead Product Manager";
    });

    const report = detectDrift(SAMPLE_RESUME, after, [
      { section: "summary", before: SAMPLE_RESUME.summary, after: "Shorter summary." },
    ]);

    expect(report.hasDrift).toBe(true);
    expect(report.undeclared.map((u) => u.path)).toContain("experience[1].role");
  });

  it("does not treat bookkeeping fields as drift", () => {
    const after = edit((d) => {
      d.summary = "Shorter summary.";
      d.experience[0].bullets[0].sourceEvidence = "different fragment";
      d.experience[0].bullets[0].keywordsHit = ["something else"];
    });

    const report = detectDrift(SAMPLE_RESUME, after, [
      { section: "summary", before: "", after: "Shorter summary." },
    ]);
    expect(report.hasDrift).toBe(false);
  });
});
