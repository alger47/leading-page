-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'LOGO', 'ICON', 'PHOTO');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'RUNNING', 'VALIDATING', 'RENDERING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('SUCCESS', 'FAILED', 'RETRIED', 'TIMED_OUT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PublicationEventType" AS ENUM ('PUBLISH', 'UNPUBLISH');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "deactivatedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultLocale" TEXT,
    "tone" TEXT,
    "budgetUsd" DECIMAL(12,2),
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locale" TEXT,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "archivedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" TEXT,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_version" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "pageId" TEXT NOT NULL,

    CONSTRAINT "page_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "storageRef" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'UPLOADED',
    "removedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdBy" TEXT,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_job" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "locale" TEXT,
    "tone" TEXT,
    "budgetUsd" DECIMAL(12,2),
    "requestJson" JSONB NOT NULL,
    "status" "GenerationStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "engineJobId" TEXT,
    "engineStatus" TEXT,
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "resultJson" JSONB,
    "eventsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "projectId" TEXT NOT NULL,
    "pageId" TEXT,

    CONSTRAINT "generation_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_attempt" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DECIMAL(18,6),
    "latencyMs" INTEGER,
    "outcome" "AttemptOutcome" NOT NULL,
    "validationJson" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "generation_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subdomain" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "subdomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_page" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "slug" TEXT,
    "publishedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT,
    "pageVersionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "subdomainId" TEXT,

    CONSTRAINT "published_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_event" (
    "id" TEXT NOT NULL,
    "type" "PublicationEventType" NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUser" TEXT,
    "snapshotJson" JSONB,
    "publishedPageId" TEXT NOT NULL,

    CONSTRAINT "publication_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_version" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentRef" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "project_userId_idx" ON "project"("userId");

-- CreateIndex
CREATE INDEX "page_projectId_idx" ON "page"("projectId");

-- CreateIndex
CREATE INDEX "page_version_pageId_createdAt_idx" ON "page_version"("pageId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "page_version_pageId_versionNumber_key" ON "page_version"("pageId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "asset_storageRef_key" ON "asset"("storageRef");

-- CreateIndex
CREATE INDEX "asset_projectId_idx" ON "asset"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_job_idempotencyKey_key" ON "generation_job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "generation_job_projectId_status_idx" ON "generation_job"("projectId", "status");

-- CreateIndex
CREATE INDEX "generation_job_status_idx" ON "generation_job"("status");

-- CreateIndex
CREATE INDEX "generation_job_projectId_createdAt_idx" ON "generation_job"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "generation_attempt_jobId_idx" ON "generation_attempt"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_attempt_jobId_stage_attempt_key" ON "generation_attempt"("jobId", "stage", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "subdomain_host_key" ON "subdomain"("host");

-- CreateIndex
CREATE INDEX "subdomain_projectId_idx" ON "subdomain"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "published_page_pageVersionId_key" ON "published_page"("pageVersionId");

-- CreateIndex
CREATE INDEX "published_page_projectId_idx" ON "published_page"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "published_page_pageId_locale_key" ON "published_page"("pageId", "locale");

-- CreateIndex
CREATE INDEX "publication_event_publishedPageId_at_idx" ON "publication_event"("publishedPageId", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_version_stage_version_key" ON "prompt_version"("stage", "version");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_attempt" ADD CONSTRAINT "generation_attempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "generation_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subdomain" ADD CONSTRAINT "subdomain_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_pageVersionId_fkey" FOREIGN KEY ("pageVersionId") REFERENCES "page_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_subdomainId_fkey" FOREIGN KEY ("subdomainId") REFERENCES "subdomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_event" ADD CONSTRAINT "publication_event_publishedPageId_fkey" FOREIGN KEY ("publishedPageId") REFERENCES "published_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
