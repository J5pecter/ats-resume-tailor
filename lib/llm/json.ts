/**
 * Models occasionally wrap JSON in prose or fences despite instructions.
 * These helpers salvage the object without ever guessing at its contents —
 * if nothing parseable is found we fail loudly rather than fabricating.
 */

export function stripFences(raw: string): string {
  let text = raw.trim();
  // ```json ... ```  or  ``` ... ```
  const fence = text.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) text = fence[1].trim();
  return text;
}

/** Extract the outermost balanced {...} block, ignoring braces inside strings. */
export function extractJsonObject(raw: string): string {
  const text = stripFences(raw);
  const start = text.indexOf("{");
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced — hand back what we have so JSON.parse produces a real error.
  return text.slice(start);
}

export function parseJsonLoose(raw: string): unknown {
  return JSON.parse(extractJsonObject(raw));
}
