-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "kycNote" TEXT,
ADD COLUMN     "kycStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "kycVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "kycVerifiedBy" TEXT;
