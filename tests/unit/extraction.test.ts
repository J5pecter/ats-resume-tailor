import { describe, expect, it } from "vitest";
import { assessExtractionQuality, normaliseWhitespace } from "@/lib/extract/text";

describe("extraction quality", () => {
  it("stays quiet on a cleanly extracted single-column PDF", () => {
    const clean = [
      "Priya Raman, Product Manager based in Mumbai India",
      "Led the redesign of the digital onboarding journey across four markets",
      "Ran weekly discovery interviews with sixty relationship managers",
      "Migrated the core ledger to an event sourced design with a squad of four",
    ].join("\n");
    expect(assessExtractionQuality(clean, "pdf")).toHaveLength(0);
  });

  it("warns when a PDF extracts as interleaved fragments", () => {
    // What a two-column resume looks like coming out of a text extractor.
    const interleaved = [
      "Priya Raman",
      "SKILLS",
      "Product Manager",
      "SQL",
      "Mumbai",
      "Mixpanel",
      "Arihant",
      "Roadmapping",
      "Apr 2023",
      "A/B",
    ].join("\n");
    const warnings = assessExtractionQuality(interleaved, "pdf");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("two-column");
  });

  it("does not warn about fragments in pasted plain text", () => {
    const fragments = ["A", "B", "C", "D"].join("\n");
    expect(assessExtractionQuality(fragments, "txt").some((w) => w.includes("two-column"))).toBe(
      false,
    );
  });

  it("collapses runaway whitespace without joining separate lines", () => {
    const messy = "Line one\r\n\r\n\r\n\r\nLine   two\u00a0here   ";
    expect(normaliseWhitespace(messy)).toBe("Line one\n\nLine two here");
  });
});
