-- CreateEnum
CREATE TYPE "GenerationKind" AS ENUM ('FULL', 'SECTION');

-- AlterTable
ALTER TABLE "generation_job" ADD COLUMN     "kind" "GenerationKind" NOT NULL DEFAULT 'FULL',
ADD COLUMN     "targetSectionId" TEXT;
