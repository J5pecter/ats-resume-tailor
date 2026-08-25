import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * Drift detection for REFINE (§5.5 implementation note).
 *
 * Models drift on "change nothing else" instructions more than you would
 * expect, and silent drift in a resume is a serious bug. So we don't trust the
 * declared change list: we diff the document field by field and require every
 * changed path to be explained by a declared change.
 */

export interface FieldChange {
  path: string;
  before: string;
  after: string;
}

export interface DeclaredChange {
  section: string;
  before: string;
  after: string;
}

export interface DriftReport {
  changed: FieldChange[];
  undeclared: FieldChange[];
  hasDrift: boolean;
}

/** Whitespace-insensitive so reflowing doesn't register as a change. */
function norm(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\s+/g, " ").trim();
}

function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** Recursively collect scalar-level differences between two documents. */
export function diffDocuments(before: unknown, after: unknown, path = ""): FieldChange[] {
  if (isLeaf(before) && isLeaf(after)) {
    return norm(before) === norm(after)
      ? []
      : [{ path: path || "(root)", before: norm(before), after: norm(after) }];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: FieldChange[] = [];
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      changes.push(...diffDocuments(before[i], after[i], `${path}[${i}]`));
    }
    return changes;
  }

  if (
    before && after &&
    typeof before === "object" && typeof after === "object" &&
    !Array.isArray(before) && !Array.isArray(after)
  ) {
    const keys = new Set([
      ...Object.keys(before as object),
      ...Object.keys(after as object),
    ]);
    const changes: FieldChange[] = [];
    for (const key of keys) {
      changes.push(
        ...diffDocuments(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        ),
      );
    }
    return changes;
  }

  // Shape changed entirely (object -> array, present -> absent, ...).
  return norm(before) === norm(after)
    ? []
    : [{ path: path || "(root)", before: norm(before), after: norm(after) }];
}

/**
 * Text long enough that a coincidental substring hit is implausible. Below
 * this, containment proves nothing: a declared summary rewrite legitimately
 * contains the words "Product Manager", which would otherwise "explain" an
 * undeclared role rename elsewhere in the document.
 */
const QUOTE_MIN_CHARS = 25;

/** A change is explained if a declared entry names its section or quotes its text. */
function isExplained(change: FieldChange, declared: DeclaredChange[]): boolean {
  const topLevel = change.path.split(/[.[]/)[0].toLowerCase();

  return declared.some((d) => {
    const section = d.section.trim().toLowerCase();
    if (section) {
      if (section.includes(topLevel)) return true;
      if (change.path.toLowerCase().includes(section)) return true;
    }

    const declaredBefore = norm(d.before);
    const declaredAfter = norm(d.after);

    // Exact match on either side is unambiguous evidence.
    if (declaredBefore && declaredBefore === change.before) return true;
    if (declaredAfter && declaredAfter === change.after) return true;

    // Containment counts only when the quoted text is substantial.
    if (
      change.before.length >= QUOTE_MIN_CHARS &&
      declaredBefore.includes(change.before)
    ) {
      return true;
    }
    if (change.after.length >= QUOTE_MIN_CHARS && declaredAfter.includes(change.after)) {
      return true;
    }

    return false;
  });
}

export function detectDrift(
  before: ResumeDoc,
  after: ResumeDoc,
  declared: DeclaredChange[],
): DriftReport {
  // sourceEvidence and keywordsHit are bookkeeping, not user-visible content;
  // they legitimately move when a bullet is reworded.
  const changed = diffDocuments(before, after).filter(
    (c) => !/\.(sourceEvidence|keywordsHit)(\[|$)/.test(c.path),
  );
  const undeclared = changed.filter((c) => !isExplained(c, declared));
  return { changed, undeclared, hasDrift: undeclared.length > 0 };
}
