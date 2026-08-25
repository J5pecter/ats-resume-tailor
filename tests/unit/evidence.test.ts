import { describe, expect, it } from "vitest";
import { checkEvidence, stripUnsupported, tokenOverlap, tokenise } from "@/lib/validate/evidence";
import { SAMPLE_RAW_TEXT, SAMPLE_RESUME } from "../fixtures/resume";
import type { ResumeDoc } from "@/lib/schema/resume";

describe("evidence check", () => {
  it("passes a resume whose bullets and skills all trace back to the source", () => {
    const result = checkEvidence(SAMPLE_RESUME, SAMPLE_RAW_TEXT);
    expect(result.passed).toBe(true);
    expect(result.checkedBullets).toBe(3);
    expect(result.checkedSkills).toBe(4);
    expect(result.checked).toBe(7);
    expect(result.failures).toHaveLength(0);
  });

  it("catches a deliberately fabricated bullet", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.experience[0].bullets.push({
      text: "Managed a $40M P&L across three international markets.",
      keywordsHit: ["P&L"],
      sourceEvidence: "Owned a forty million dollar profit and loss statement spanning Germany, Brazil and Japan",
    });

    const result = checkEvidence(tampered, SAMPLE_RAW_TEXT);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].kind).toBe("bullet");
    expect(result.failures[0].reason).toBe("unsupported");
    expect(result.failures[0].text).toContain("$40M P&L");
  });

  it("catches a bullet with no evidence at all", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.experience[1].bullets.push({
      text: "Held a Kubernetes certification.",
      keywordsHit: [],
      sourceEvidence: "   ",
    });

    const result = checkEvidence(tampered, SAMPLE_RAW_TEXT);
    expect(result.failures.map((f) => f.reason)).toEqual(["empty"]);
  });

  it("strips only the failing bullets and keeps the rest of the document", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.experience[0].bullets.push({
      text: "Invented achievement.",
      keywordsHit: [],
      sourceEvidence: "completely unrelated sentence about submarine cartography",
    });

    const { failures } = checkEvidence(tampered, SAMPLE_RAW_TEXT);
    const cleaned = stripUnsupported(tampered, failures);

    expect(cleaned.experience[0].bullets).toHaveLength(2);
    expect(cleaned.experience[1].bullets).toHaveLength(1);
    expect(checkEvidence(cleaned, SAMPLE_RAW_TEXT).passed).toBe(true);
  });

  it("tolerates rewording and punctuation drift in the evidence fragment", () => {
    const source = new Set(tokenise(SAMPLE_RAW_TEXT));
    const overlap = tokenOverlap(
      "Led redesign of the digital onboarding journey - KYC drop-off fell 31%.",
      source,
    );
    expect(overlap).toBeGreaterThanOrEqual(0.7);
  });

  it("drops roles that lose every bullet", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.experience[1].bullets = [
      { text: "Fabricated.", keywordsHit: [], sourceEvidence: "unrelated text about beekeeping" },
    ];
    const { failures } = checkEvidence(tampered, SAMPLE_RAW_TEXT);
    const cleaned = stripUnsupported(tampered, failures);
    expect(cleaned.experience).toHaveLength(1);
  });
});

describe("evidence check — skills", () => {
  it("accepts a skill named verbatim in the source, whatever its evidence says", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills[1].skills = [{ name: "SQL", sourceEvidence: "" }];

    const result = checkEvidence(doc, SAMPLE_RAW_TEXT);
    expect(result.failures.filter((f) => f.kind === "skill")).toHaveLength(0);
  });

  it("accepts a skill relabelled into the JD's vocabulary when the evidence traces", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // "Experimentation" appears nowhere in the source; the A/B testing work does.
    doc.coreSkills[0].skills = [
      {
        name: "Experimentation",
        sourceEvidence: "Ran A/B tests on the onboarding funnel across two quarters",
      },
    ];

    const result = checkEvidence(doc, SAMPLE_RAW_TEXT);
    expect(result.failures.filter((f) => f.kind === "skill")).toHaveLength(0);
  });

  it("catches an invented skill with no evidence", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills[1].skills.push({ name: "Kubernetes", sourceEvidence: "" });

    const result = checkEvidence(doc, SAMPLE_RAW_TEXT);
    const failures = result.failures.filter((f) => f.kind === "skill");
    expect(failures).toHaveLength(1);
    expect(failures[0].text).toBe("Kubernetes");
    expect(failures[0].reason).toBe("empty");
    expect(failures[0].where).toBe("Core skills · Analytics");
  });

  it("catches an invented skill propped up by invented evidence", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills[0].skills.push({
      name: "Machine learning",
      sourceEvidence: "Trained gradient boosted models for credit risk scoring in production",
    });

    const result = checkEvidence(doc, SAMPLE_RAW_TEXT);
    const failures = result.failures.filter((f) => f.kind === "skill");
    expect(failures).toHaveLength(1);
    expect(failures[0].text).toBe("Machine learning");
    expect(failures[0].reason).toBe("unsupported");
  });

  it("matches skill names as whole words", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // "Go" must not be considered supported by "Google" appearing in the source.
    doc.coreSkills[0].skills = [{ name: "Go", sourceEvidence: "" }];

    const result = checkEvidence(doc, `${SAMPLE_RAW_TEXT}\nWorked with Google Analytics`);
    expect(result.failures.filter((f) => f.kind === "skill")).toHaveLength(1);
  });

  it("strips failing skills and removes groups left empty", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills.push({
      category: "Infrastructure",
      skills: [
        { name: "Kubernetes", sourceEvidence: "" },
        { name: "Terraform", sourceEvidence: "" },
      ],
    });
    doc.coreSkills[1].skills.push({ name: "Tableau", sourceEvidence: "" });

    const { failures } = checkEvidence(doc, SAMPLE_RAW_TEXT);
    const cleaned = stripUnsupported(doc, failures);

    // The wholly-invented group is gone; the partly-invented one survives intact.
    expect(cleaned.coreSkills.map((g) => g.category)).toEqual(["Product", "Analytics"]);
    expect(cleaned.coreSkills[1].skills.map((s) => s.name)).toEqual([
      "SQL",
      "Funnel conversion analysis",
    ]);
    expect(checkEvidence(cleaned, SAMPLE_RAW_TEXT).passed).toBe(true);
  });

  it("strips bullets and skills together in one pass", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills[0].skills.push({ name: "Kubernetes", sourceEvidence: "" });
    doc.experience[0].bullets.push({
      text: "Invented achievement.",
      keywordsHit: [],
      sourceEvidence: "completely unrelated sentence about submarine cartography",
    });

    const { failures } = checkEvidence(doc, SAMPLE_RAW_TEXT);
    expect(failures.map((f) => f.kind).sort()).toEqual(["bullet", "skill"]);

    const cleaned = stripUnsupported(doc, failures);
    expect(checkEvidence(cleaned, SAMPLE_RAW_TEXT).passed).toBe(true);
  });
});
