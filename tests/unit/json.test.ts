import { describe, expect, it } from "vitest";
import { extractJsonObject, parseJsonLoose, stripFences } from "@/lib/llm/json";

describe("JSON salvage", () => {
  it("passes clean JSON through untouched", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose around the object", () => {
    expect(parseJsonLoose('Here you go:\n{"a": 1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it("does not mistake braces inside strings for structure", () => {
    const raw = '{"note":"a } brace and a { brace","ok":true}';
    expect(extractJsonObject(raw)).toBe(raw);
    expect(parseJsonLoose(raw)).toEqual({ note: "a } brace and a { brace", ok: true });
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"quote":"she said \\"hi\\" and left"}';
    expect(parseJsonLoose(raw)).toEqual({ quote: 'she said "hi" and left' });
  });

  it("throws rather than guessing when the object is truncated", () => {
    expect(() => parseJsonLoose('{"a": 1, "b":')).toThrow();
  });
});
