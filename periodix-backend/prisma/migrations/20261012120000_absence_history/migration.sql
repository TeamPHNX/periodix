-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "announced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "excuseStatus" TEXT,
ADD COLUMN     "text" TEXT,
ADD COLUMN     "untisUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "updatedBy" TEXT;

-- CreateTable
CREATE TABLE "AbsenceRevision" (
    "id" TEXT NOT NULL,
    "absenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "untisId" INTEGER NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL,
    "editedBy" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AbsenceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceRevision_userId_untisId_idx" ON "AbsenceRevision"("userId", "untisId");

-- CreateIndex
CREATE INDEX "AbsenceRevision_absenceId_idx" ON "AbsenceRevision"("absenceId");

-- AddForeignKey
ALTER TABLE "AbsenceRevision" ADD CONSTRAINT "AbsenceRevision_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "Absence"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Absences stored before this migration already went through the old
-- notification logic; do not announce them again.
UPDATE "Absence" SET "announced" = true;
