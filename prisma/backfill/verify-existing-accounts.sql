-- Grandfather every account that predates email verification.
--
-- Sign-in refuses an unverified account. Accounts created before verification
-- existed have a null there and no way to fix it themselves, so without this
-- every existing user is locked out of their own data.
--
-- Idempotent: only null rows are touched, so it is safe on every deploy.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
