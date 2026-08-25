import { z } from "zod";

/**
 * Tolerance helpers for model-produced JSON.
 *
 * Models express "there are none" as `null` about as often as `[]`, and "not
 * stated" as `null` about as often as `""`. Both mean the same thing, and both
 * are the model complying with the instruction — so rejecting one of them buys
 * nothing and costs a retry, or on a weaker model an outright failure.
 *
 * This is tolerance about *shape*, not about substance. Every rule that
 * actually matters — evidence tracing, forbidden keywords, drift — is enforced
 * after parsing and is untouched by this.
 */

/** An array that also accepts null/undefined, meaning "none". */
export function tolerantArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => value ?? [], z.array(item));
}

/** A string that also accepts null/undefined, meaning "not stated". */
export function tolerantString(fallback = "") {
  return z.preprocess((value) => value ?? fallback, z.string());
}

/**
 * An optional field that also accepts null. `.optional()` alone rejects null,
 * and models use null and "key absent" interchangeably to mean "not present".
 */
export function tolerantOptional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => value ?? undefined, schema.optional());
}

/** A number that accepts null (meaning "not stated") and numeric strings. */
export function tolerantNullableNumber() {
  return z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.coerce.number().nullable(),
  );
}
