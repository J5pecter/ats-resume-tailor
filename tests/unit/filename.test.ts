import { describe, expect, it } from "vitest";
import { exportFilename } from "@/lib/export/filename";

describe("export filename", () => {
  it("uses {Name}_{Role}.{ext} with spaces as underscores", () => {
    expect(exportFilename("Priya Raman", "Product Manager", "docx")).toBe(
      "Priya_Raman_Product_Manager.docx",
    );
  });

  it("drops punctuation that is unsafe in a filename", () => {
    expect(exportFilename("Priya Raman", "PM — Razorpay (Fintech)", "pdf")).toBe(
      "Priya_Raman_PM_Razorpay_Fintech.pdf",
    );
  });

  it("falls back to a usable name when everything is empty", () => {
    expect(exportFilename("", "", "pdf")).toBe("Resume.pdf");
  });
});
