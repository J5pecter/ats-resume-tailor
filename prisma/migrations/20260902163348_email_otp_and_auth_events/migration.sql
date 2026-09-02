-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "method" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "exported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EmailOtp_email_purpose_expiresAt_idx" ON "EmailOtp"("email", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthEvent_email_createdAt_idx" ON "AuthEvent"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_exported_idx" ON "AuthEvent"("exported");
