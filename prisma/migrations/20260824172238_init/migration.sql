-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobDescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceResume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceResume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TailoredResume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobDescriptionId" TEXT NOT NULL,
    "sourceResumeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentJson" JSONB NOT NULL,
    "analysisJson" JSONB NOT NULL,
    "changeLogJson" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TailoredResume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TailoredResume_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TailoredResume_sourceResumeId_fkey" FOREIGN KEY ("sourceResumeId") REFERENCES "SourceResume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "promptName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "JobDescription_userId_createdAt_idx" ON "JobDescription"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "JobDescription_userId_contentHash_idx" ON "JobDescription"("userId", "contentHash");

-- CreateIndex
CREATE INDEX "SourceResume_userId_createdAt_idx" ON "SourceResume"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceResume_userId_contentHash_idx" ON "SourceResume"("userId", "contentHash");

-- CreateIndex
CREATE INDEX "TailoredResume_userId_jobDescriptionId_version_idx" ON "TailoredResume"("userId", "jobDescriptionId", "version");

-- CreateIndex
CREATE INDEX "LlmCall_userId_createdAt_idx" ON "LlmCall"("userId", "createdAt");
