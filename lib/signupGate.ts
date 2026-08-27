/**
 * Whether new accounts need an invite code.
 *
 * A deployed instance of this app is a standing offer to strangers: whoever
 * signs up shares the owner's API key and its rate limit, and leaves their
 * resume — sensitive personal data — in the owner's database. Vercel's free
 * tier cannot protect a production deployment (its authentication covers
 * preview deployments only, and password protection is a paid feature), so the
 * gate lives in the app instead.
 *
 * Deliberately its own module, free of auth and framework imports, so the
 * policy can be tested directly.
 *
 * Unset locally, so a fresh checkout still signs up in one step.
 */
export function signupCodeRequired(): boolean {
  return Boolean(process.env.SIGNUP_CODE?.trim());
}

export function signupCodeMatches(supplied: string | undefined): boolean {
  const expected = process.env.SIGNUP_CODE?.trim();
  if (!expected) return true;
  return (supplied ?? "").trim() === expected;
}
