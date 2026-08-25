import { describe, expect, it } from "vitest";
import {
  RELATEDNESS_THRESHOLD,
  checkEvidence,
  relatedness,
  stripUnsupported,
  tokenOverlap,
  tokenise,
} from "@/lib/validate/evidence";
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

describe("evidence must be about the claim, not merely real", () => {
  // Traceability alone proved insufficient in practice: a weak model attached
  // the employer's own name line to every bullet, and copied a bullet about
  // one employer onto another. Every citation was genuinely present in the
  // source, so every one passed. Nothing tied it to what the bullet claimed.
  it("rejects a real fragment that has nothing to do with the bullet", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.experience[0].bullets = [
      {
        text: "Led the redesign of the digital onboarding journey, cutting KYC drop-off by 31 percent.",
        keywordsHit: [],
        // Verbatim from the source — and completely unrelated to the claim.
        sourceEvidence: "Arihant Securities \u2014 Senior Product Manager",
      },
    ];

    const result = checkEvidence(doc, SAMPLE_RAW_TEXT);
    const failure = result.failures.find((f) => f.kind === "bullet");
    expect(failure).toBeDefined();
    expect(failure?.reason).toBe("unrelated");
  });

  it("rejects a bullet copied onto the wrong employer", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // Paylane never did the onboarding work; the citation belongs to Arihant.
    doc.experience[1].bullets.push({
      text: "Led the digital onboarding journey and prioritised the 2024 roadmap.",
      keywordsHit: [],
      sourceEvidence: "Arihant Securities \u2014 Senior Product Manager",
    });

    const { failures } = checkEvidence(doc, SAMPLE_RAW_TEXT);
    expect(failures.some((f) => f.reason === "unrelated")).toBe(true);
  });

  it("still accepts a heavy rewrite that keeps the substance", () => {
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.experience[0].bullets = [
      {
        // Reworded into the posting's vocabulary, same underlying facts.
        text: "Owned the digital onboarding funnel end to end, reducing KYC drop-off 31% across 40,000 monthly applicants.",
        keywordsHit: ["digital onboarding", "KYC"],
        sourceEvidence:
          "Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants",
      },
    ];

    expect(checkEvidence(doc, SAMPLE_RAW_TEXT).passed).toBe(true);
  });

  it("does not reject the whole known-good sample document", () => {
    // Guards against the relatedness bar being set so high that legitimate
    // tailoring starts failing.
    expect(checkEvidence(SAMPLE_RESUME, SAMPLE_RAW_TEXT).passed).toBe(true);
  });

  it("scores relatedness against the shorter side", () => {
    // A short bullet citing a long fragment should not be penalised for length.
    expect(
      relatedness(
        "Cut KYC drop-off 31%.",
        "Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants",
      ),
    ).toBeGreaterThanOrEqual(RELATEDNESS_THRESHOLD);

    expect(relatedness("Led the redesign.", "Arihant Securities Senior Product Manager")).toBe(0);
  });
});
