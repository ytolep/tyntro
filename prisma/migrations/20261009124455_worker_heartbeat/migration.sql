-- CreateTable
CREATE TABLE "public"."WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastTickAt" TIMESTAMP(3) NOT NULL,
    "lastPaymentsCheckAt" TIMESTAMP(3),
    "lastDayRollCheckAt" TIMESTAMP(3),
    "pid" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
