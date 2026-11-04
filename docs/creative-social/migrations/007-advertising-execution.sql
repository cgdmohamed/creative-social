-- Consolidated release: additive execution, assets and explicit management consent.
-- Apply after 006 on a backed-up database in an approved upgrade window.
BEGIN;
-- AlterTable
ALTER TABLE "AdCampaignReview" ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validation" JSONB;

-- AlterTable
ALTER TABLE "AdvertisingConnection" ADD COLUMN     "authorizationRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "managementAuthorized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AdvertisingOAuthState" ADD COLUMN     "management" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PaidSyncJob" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdCampaignExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "actorId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "resources" JSONB NOT NULL DEFAULT '{}',
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaignExecutionStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "requestDigest" TEXT NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "requestId" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AdCampaignExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertisingAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "providerId" TEXT,
    "imageHash" TEXT,
    "thumbnailUrl" TEXT,
    "error" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvertisingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignExecution_reviewId_key" ON "AdCampaignExecution"("reviewId");

-- CreateIndex
CREATE INDEX "AdCampaignExecution_organizationId_createdAt_idx" ON "AdCampaignExecution"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignExecution_id_organizationId_key" ON "AdCampaignExecution"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignExecution_reviewId_organizationId_key" ON "AdCampaignExecution"("reviewId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignExecutionStep_executionId_position_key" ON "AdCampaignExecutionStep"("executionId", "position");

-- CreateIndex
CREATE INDEX "AdvertisingAsset_organizationId_accountId_createdAt_idx" ON "AdvertisingAsset"("organizationId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdvertisingAsset_organizationId_creationKey_key" ON "AdvertisingAsset"("organizationId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdvertisingAsset_id_organizationId_key" ON "AdvertisingAsset"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignReview_id_organizationId_key" ON "AdCampaignReview"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "AdCampaignExecution" ADD CONSTRAINT "AdCampaignExecution_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "AdReportingAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignExecution" ADD CONSTRAINT "AdCampaignExecution_reviewId_organizationId_fkey" FOREIGN KEY ("reviewId", "organizationId") REFERENCES "AdCampaignReview"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignExecutionStep" ADD CONSTRAINT "AdCampaignExecutionStep_executionId_organizationId_fkey" FOREIGN KEY ("executionId", "organizationId") REFERENCES "AdCampaignExecution"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingAsset" ADD CONSTRAINT "AdvertisingAsset_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "AdReportingAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Older additive upgrades were executed by the maintenance role. Give the
-- dedicated application role ownership of the new schema objects so Prisma's
-- runtime datasource can introspect them and subsequent reviewed migrations
-- do not silently create admin-owned, inaccessible objects.
-- Execute as the PostgreSQL maintenance role on an existing installation.
ALTER TABLE "AdvertisingConnection" OWNER TO creative;
ALTER TABLE "AdvertisingOAuthState" OWNER TO creative;
ALTER TABLE "PaidReachSnapshot" OWNER TO creative;
ALTER TABLE "PaidSyncJob" OWNER TO creative;
ALTER TABLE "PaidReportSchedule" OWNER TO creative;
ALTER TABLE "PaidReportRun" OWNER TO creative;
ALTER TABLE "AdCampaignDraft" OWNER TO creative;
ALTER TABLE "AdCampaignReview" OWNER TO creative;
ALTER TABLE "AdCampaignAudit" OWNER TO creative;
ALTER TABLE "AdCampaignExecution" OWNER TO creative;
ALTER TABLE "AdCampaignExecutionStep" OWNER TO creative;
ALTER TABLE "AdvertisingAsset" OWNER TO creative;
ALTER TYPE "AdvertisingConnectionStatus" OWNER TO creative;

COMMIT;
