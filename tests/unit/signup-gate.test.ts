import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signupCodeMatches, signupCodeRequired } from "@/lib/signupGate";

/**
 * A deployed instance is a standing offer to strangers: whoever signs up shares
 * the owner's API key and leaves their resume in the owner's database.
 */
const saved = { ...process.env };
beforeEach(() => { delete process.env.SIGNUP_CODE; });
afterEach(() => { process.env = { ...saved }; });

describe("signup gate", () => {
  it("is open when no code is configured, so a fresh checkout still works", () => {
    expect(signupCodeRequired()).toBe(false);
    expect(signupCodeMatches(undefined)).toBe(true);
    expect(signupCodeMatches("anything")).toBe(true);
  });

  it("closes as soon as a code is set", () => {
    process.env.SIGNUP_CODE = "let-me-in";
    expect(signupCodeRequired()).toBe(true);
    expect(signupCodeMatches("let-me-in")).toBe(true);
  });

  it("refuses a wrong, absent, or empty code", () => {
    process.env.SIGNUP_CODE = "let-me-in";
    for (const attempt of [undefined, "", "   ", "Let-Me-In", "let-me-in-please", "wrong"]) {
      expect(signupCodeMatches(attempt), `"${attempt}" must not pass`).toBe(false);
    }
  });

  it("ignores surrounding whitespace, which a paste often carries", () => {
    process.env.SIGNUP_CODE = "let-me-in";
    expect(signupCodeMatches("  let-me-in  ")).toBe(true);
  });

  it("treats a blank configured code as no gate at all", () => {
    process.env.SIGNUP_CODE = "   ";
    expect(signupCodeRequired()).toBe(false);
    expect(signupCodeMatches(undefined)).toBe(true);
  });

});
