-- AlterTable
ALTER TABLE "public"."Purchase" ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundTxSignature" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);
