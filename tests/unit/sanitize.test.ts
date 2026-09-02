import { describe, expect, it } from "vitest";
import { sanitiseBullet, sanitiseResumeDoc, sanitiseText } from "@/lib/validate/sanitize";
import { checkEvidence } from "@/lib/validate/evidence";
import { SAMPLE_RAW_TEXT, SAMPLE_RESUME } from "../fixtures/resume";
import type { ResumeDoc } from "@/lib/schema/resume";

describe("ATS text sanitisation", () => {
  it("normalises every dash look-alike to a plain hyphen", () => {
    // U+2010 U+2011 U+2013 U+2014 U+2212 all render almost identically.
    expect(sanitiseText("drop\u2011off")).toBe("drop-off");
    expect(sanitiseText("drop\u2013off")).toBe("drop-off");
    expect(sanitiseText("drop\u2014off")).toBe("drop-off");
    expect(sanitiseText("drop\u2212off")).toBe("drop-off");
  });

  it("normalises curly quotes and ellipsis", () => {
    expect(sanitiseText("\u201Cthe team\u2019s roadmap\u201D")).toBe("\"the team's roadmap\"");
    expect(sanitiseText("and so on\u2026")).toBe("and so on...");
  });

  it("removes zero-width characters that split tokens invisibly", () => {
    expect(sanitiseText("Kuber\u200Bnetes")).toBe("Kubernetes");
    expect(sanitiseText("\uFEFFLed the redesign")).toBe("Led the redesign");
  });

  it("collapses non-breaking and exotic spaces", () => {
    expect(sanitiseText("40,000\u00A0monthly\u2009applicants")).toBe("40,000 monthly applicants");
  });

  it("strips markdown emphasis the model was told not to emit", () => {
    expect(sanitiseText("**Led** the __redesign__")).toBe("Led the redesign");
  });

  it("strips a list marker the model prefixed to a bullet", () => {
    expect(sanitiseBullet("\u2022 Led the redesign")).toBe("Led the redesign");
    expect(sanitiseBullet("- Led the redesign")).toBe("Led the redesign");
    // A hyphen inside the sentence is content, not a marker.
    expect(sanitiseBullet("Led the drop-off redesign")).toBe("Led the drop-off redesign");
  });

  it("leaves ASCII-only text untouched", () => {
    const ascii: ResumeDoc = structuredClone(SAMPLE_RESUME);
    ascii.contact.headline = "Product Manager - Fintech and Digital Onboarding";
    expect(sanitiseResumeDoc(ascii)).toEqual(ascii);
  });

  it("is idempotent", () => {
    const once = sanitiseResumeDoc(SAMPLE_RESUME);
    expect(sanitiseResumeDoc(once)).toEqual(once);
  });

  it("does not add keys for optional fields that were absent", () => {
    const minimal: ResumeDoc = structuredClone(SAMPLE_RESUME);
    delete minimal.projects;
    delete minimal.certifications;
    delete minimal.experience[1].location;

    const clean = sanitiseResumeDoc(minimal);
    expect("projects" in clean).toBe(false);
    expect("certifications" in clean).toBe(false);
    expect("location" in clean.experience[1]).toBe(false);
  });

  it("rescues a skill that typographic hyphens would otherwise get rejected", () => {
    // Short evidence is where a look-alike codepoint actually changes the
    // verdict: one corrupted token out of four drags the overlap below the
    // 70% threshold, whereas the same token in a long bullet is absorbed.
    // This is the live failure that prompted the whole module — a relabelled
    // skill scoring 40% purely because of a non-breaking hyphen.
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.coreSkills[0].skills = [
      {
        name: "Funnel optimisation",
        sourceEvidence: "KYC drop‑off fell 31%",
      },
    ];

    const before = checkEvidence(tampered, SAMPLE_RAW_TEXT);
    expect(before.failures.map((f) => f.text)).toContain("Funnel optimisation");

    const after = checkEvidence(sanitiseResumeDoc(tampered), SAMPLE_RAW_TEXT);
    expect(after.passed).toBe(true);
  });

  it("normalises every text-bearing field of the document", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.summary = "Product Manager \u2014 six years\u2019 experience";
    doc.coreSkills[0].skills[0].name = "A/B\u00A0testing";
    doc.education[0].institution = "University of Mumbai\u200B";
    doc.certifications = [{ name: "**Certified Scrum Product Owner**" }];

    const clean = sanitiseResumeDoc(doc);
    expect(clean.summary).toBe("Product Manager - six years' experience");
    expect(clean.coreSkills[0].skills[0].name).toBe("A/B testing");
    expect(clean.education[0].institution).toBe("University of Mumbai");
    expect(clean.certifications?.[0].name).toBe("Certified Scrum Product Owner");
  });

  it("leaves no non-ASCII punctuation anywhere in a sanitised document", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.summary = "Cut drop\u2011off by 31%\u2026 \u201Cmeaningfully\u201D";
    doc.experience[0].bullets[0].text = "Led\u00A0the\u2013redesign";

    const serialised = JSON.stringify(sanitiseResumeDoc(doc));
    expect(serialised).not.toMatch(/[\u2010-\u2015\u2018-\u201F\u2026\u00A0\u200B-\u200D\uFEFF]/);
  });
});

describe("punctuation spacing", () => {
  it("closes up a space before a comma", () => {
    // Straight from a real CV: it renders directly under the candidate's name.
    expect(sanitiseText("Kandivali ,Mumbai")).toBe("Kandivali, Mumbai");
  });

  it("adds the missing space after one", () => {
    expect(sanitiseText("Mumbai,India")).toBe("Mumbai, India");
  });

  it("leaves correct punctuation alone", () => {
    expect(sanitiseText("Kandivali, Mumbai")).toBe("Kandivali, Mumbai");
    expect(sanitiseText("Reduced drop-off by 31%.")).toBe("Reduced drop-off by 31%.");
  });

  it("does not mangle numbers, which is the whole point of the narrow rule", () => {
    // The first draft of this rule produced "40, 000" and "6: 00". Corrupting
    // a metric is the failure this codebase exists to prevent.
    expect(sanitiseText("40,000 monthly applicants")).toBe("40,000 monthly applicants");
    expect(sanitiseText("CGPA 8.20")).toBe("CGPA 8.20");
    expect(sanitiseText("Cut runtime from 6:00 to 0:40")).toBe("Cut runtime from 6:00 to 0:40");
    expect(sanitiseText("2.1 crore")).toBe("2.1 crore");
  });

  it("never welds two lines together", () => {
    // A greedy whitespace class would match the newline before a comma and
    // join two bullets into one, which is a far worse edit than the typo.
    const two = "Led the team\nDelivered on time";
    expect(sanitiseText(two)).toContain("\n");
  });
});

