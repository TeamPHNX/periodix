-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "classesSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."UserClassMembership" (
    "userId" TEXT NOT NULL,
    "classId" INTEGER NOT NULL,
    "className" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserClassMembership_pkey" PRIMARY KEY ("userId","classId")
);

-- CreateIndex
CREATE INDEX "UserClassMembership_classId_idx" ON "public"."UserClassMembership"("classId");

-- AddForeignKey
ALTER TABLE "public"."UserClassMembership" ADD CONSTRAINT "UserClassMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
