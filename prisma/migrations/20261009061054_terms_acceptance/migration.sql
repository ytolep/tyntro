-- CreateTable
CREATE TABLE "public"."TermsAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "termsVersion" TEXT NOT NULL,
    "refundsVersion" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TermsAcceptance_purchaseId_key" ON "public"."TermsAcceptance"("purchaseId");

-- CreateIndex
CREATE INDEX "TermsAcceptance_userId_acceptedAt_idx" ON "public"."TermsAcceptance"("userId", "acceptedAt");

-- AddForeignKey
ALTER TABLE "public"."TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "public"."Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
