-- Additive upgrade from Creative Social main; independent of Inbox PR #1. Apply once.
BEGIN;
-- CreateEnum
CREATE TYPE "ReportScope" AS ENUM ('CHANNEL', 'POST');

-- CreateEnum
CREATE TYPE "ReportMetricKind" AS ENUM ('FLOW', 'STOCK', 'LEVEL', 'AVERAGE');

-- CreateEnum
CREATE TYPE "AdReportingProvider" AS ENUM ('META_ADS', 'GOOGLE_ADS');

-- CreateTable
CREATE TABLE "ReportMetricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "customerId" TEXT,
    "scope" "ReportScope" NOT NULL,
    "entityId" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "kind" "ReportMetricKind" NOT NULL,
    "unit" TEXT NOT NULL,
    "traffic" TEXT NOT NULL DEFAULT 'PLATFORM_TOTAL',
    "value" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCollectionState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "postCursor" TEXT,
    "requestedAt" TIMESTAMP(3),
    "requestKey" TEXT,
    "requestedFor" TEXT,
    "detail" TEXT,

    CONSTRAINT "ReportCollectionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCampaignPost" (
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,

    CONSTRAINT "ReportCampaignPost_pkey" PRIMARY KEY ("campaignId","postId")
);

-- CreateTable
CREATE TABLE "AdReportingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "provider" "AdReportingProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "credentialReference" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdReportingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdReportingDailyMetric" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "level" TEXT NOT NULL,
    "externalEntityId" TEXT NOT NULL,
    "externalCampaignId" TEXT,
    "externalAdGroupId" TEXT,
    "attributionWindow" TEXT NOT NULL,
    "impressions" BIGINT,
    "clicks" BIGINT,
    "spend" DECIMAL(20,6),
    "conversions" DECIMAL(20,6),
    "conversionValue" DECIMAL(20,6),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdReportingDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportMetricSnapshot_organizationId_customerId_scope_date_idx" ON "ReportMetricSnapshot"("organizationId", "customerId", "scope", "date");

-- CreateIndex
CREATE INDEX "ReportMetricSnapshot_organizationId_integrationId_scope_dat_idx" ON "ReportMetricSnapshot"("organizationId", "integrationId", "scope", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportMetricSnapshot_integrationId_scope_entityId_metric_da_key" ON "ReportMetricSnapshot"("integrationId", "scope", "entityId", "metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCollectionState_integrationId_key" ON "ReportCollectionState"("integrationId");

-- CreateIndex
CREATE INDEX "ReportCollectionState_requestedAt_idx" ON "ReportCollectionState"("requestedAt");

-- CreateIndex
CREATE INDEX "ReportCollectionState_organizationId_idx" ON "ReportCollectionState"("organizationId");

-- CreateIndex
CREATE INDEX "ReportCampaign_organizationId_customerId_idx" ON "ReportCampaign"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCampaign_id_organizationId_key" ON "ReportCampaign"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ReportCampaignPost_postId_idx" ON "ReportCampaignPost"("postId");

-- CreateIndex
CREATE INDEX "AdReportingAccount_organizationId_customerId_idx" ON "AdReportingAccount"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "AdReportingAccount_organizationId_provider_externalAccountI_key" ON "AdReportingAccount"("organizationId", "provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "AdReportingDailyMetric_accountId_date_idx" ON "AdReportingDailyMetric"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdReportingDailyMetric_accountId_date_level_externalEntityI_key" ON "AdReportingDailyMetric"("accountId", "date", "level", "externalEntityId", "attributionWindow");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_id_organizationId_key" ON "Integration"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_id_organizationId_key" ON "Post"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "ReportMetricSnapshot" ADD CONSTRAINT "ReportMetricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMetricSnapshot" ADD CONSTRAINT "ReportMetricSnapshot_integrationId_organizationId_fkey" FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCollectionState" ADD CONSTRAINT "ReportCollectionState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCollectionState" ADD CONSTRAINT "ReportCollectionState_integrationId_organizationId_fkey" FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCampaign" ADD CONSTRAINT "ReportCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCampaignPost" ADD CONSTRAINT "ReportCampaignPost_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "ReportCampaign"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCampaignPost" ADD CONSTRAINT "ReportCampaignPost_postId_organizationId_fkey" FOREIGN KEY ("postId", "organizationId") REFERENCES "Post"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReportingAccount" ADD CONSTRAINT "AdReportingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReportingDailyMetric" ADD CONSTRAINT "AdReportingDailyMetric_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdReportingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
