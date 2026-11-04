-- Additive Phase 3 upgrade. Review and back up before applying once.
BEGIN;
-- AlterTable
ALTER TABLE "AdReportingAccount" ADD COLUMN     "reportingRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "valueTrackingVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AdReportingDailyMetric" ADD COLUMN     "attributionFingerprint" TEXT,
ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "definitionVersion" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "entityName" TEXT,
ADD COLUMN     "leads" DECIMAL(20,6),
ADD COLUMN     "purchaseConversionValue" DECIMAL(20,6),
ADD COLUMN     "reach" BIGINT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "valueTrackingVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaidReachSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "level" TEXT NOT NULL,
    "externalEntityId" TEXT NOT NULL,
    "attributionWindow" TEXT NOT NULL,
    "reach" BIGINT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidReachSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidSyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "requestedById" TEXT,
    "reportingRevision" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DAILY',
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "attributionWindow" TEXT NOT NULL,
    "attributionFingerprint" TEXT,
    "attributionDetails" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidReportSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "query" JSONB NOT NULL,
    "rollingDays" INTEGER NOT NULL,
    "cadenceDays" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "recipient" TEXT,
    "requireFresh" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "PaidReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidReportRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "periodKey" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "errorCode" TEXT,
    "artifact" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaidReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaidReachSnapshot_accountId_fromDate_toDate_level_externalE_key" ON "PaidReachSnapshot"("accountId", "fromDate", "toDate", "level", "externalEntityId", "attributionWindow");

-- CreateIndex
CREATE UNIQUE INDEX "PaidSyncJob_dedupeKey_key" ON "PaidSyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "PaidSyncJob_status_nextAttemptAt_idx" ON "PaidSyncJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PaidSyncJob_accountId_level_fromDate_toDate_idx" ON "PaidSyncJob"("accountId", "level", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "PaidReportSchedule_enabled_nextRunAt_idx" ON "PaidReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaidReportSchedule_id_organizationId_key" ON "PaidReportSchedule"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidReportRun_periodKey_key" ON "PaidReportRun"("periodKey");

-- CreateIndex
CREATE INDEX "PaidReportRun_organizationId_createdAt_idx" ON "PaidReportRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdReportingAccount_id_organizationId_key" ON "AdReportingAccount"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "PaidReachSnapshot" ADD CONSTRAINT "PaidReachSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdReportingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidSyncJob" ADD CONSTRAINT "PaidSyncJob_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "AdReportingAccount"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReportSchedule" ADD CONSTRAINT "PaidReportSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReportRun" ADD CONSTRAINT "PaidReportRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReportRun" ADD CONSTRAINT "PaidReportRun_scheduleId_organizationId_fkey" FOREIGN KEY ("scheduleId", "organizationId") REFERENCES "PaidReportSchedule"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
