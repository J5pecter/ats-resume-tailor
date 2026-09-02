-- Grandfather every account that existed before email verification did.
--
-- Verification was added after these accounts were created, so their owners
-- were never asked to prove an address and have no way to. Because sign-in now
-- refuses an unverified account, leaving them null locks every existing user
-- out of their own data — including the person who deployed it.
--
-- Their addresses were vouched for by the invite code that gated signup at the
-- time, which is the closest thing to proof that era had. Anyone created from
-- here on goes through the code.
UPDATE "User"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL;
