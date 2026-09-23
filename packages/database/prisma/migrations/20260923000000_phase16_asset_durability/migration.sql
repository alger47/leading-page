-- Phase 16 review fixes: job baseVersion, unique version-per-job, durable
-- project-scoped generated assets.

-- AlterTable: generation_job.baseVersion (page version the request was based on)
ALTER TABLE "generation_job" ADD COLUMN "baseVersion" INTEGER;

-- AlterTable: page_version.generationJobId (unique: one version per job)
ALTER TABLE "page_version" ADD COLUMN "generationJobId" TEXT;
CREATE UNIQUE INDEX "page_version_generationJobId_key" ON "page_version"("generationJobId");

-- CreateTable: generated_asset (engine raster bytes, scoped per project+job)
CREATE TABLE "generated_asset" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "generated_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generated_asset_jobId_ref_key" ON "generated_asset"("jobId", "ref");
CREATE INDEX "generated_asset_projectId_idx" ON "generated_asset"("projectId");

-- AddForeignKey
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "generation_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;