-- Phase 4: additive local campaign drafts, immutable reviews and audit history.
-- Apply after 005 on a backed-up database during an approved upgrade.
BEGIN;
-- CreateTable
CREATE TABLE "AdCampaignDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "spec" JSONB NOT NULL,
    "creationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaignReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "AdCampaignReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaignAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "draftId" TEXT,
    "reviewId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdCampaignAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaignDraft_organizationId_updatedAt_idx" ON "AdCampaignDraft"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignDraft_organizationId_creationKey_key" ON "AdCampaignDraft"("organizationId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignDraft_id_organizationId_key" ON "AdCampaignDraft"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AdCampaignReview_organizationId_status_idx" ON "AdCampaignReview"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignReview_draftId_revision_key" ON "AdCampaignReview"("draftId", "revision");

-- CreateIndex
CREATE INDEX "AdCampaignAudit_organizationId_createdAt_idx" ON "AdCampaignAudit"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdCampaignDraft" ADD CONSTRAINT "AdCampaignDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignDraft" ADD CONSTRAINT "AdCampaignDraft_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "AdReportingAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignReview" ADD CONSTRAINT "AdCampaignReview_draftId_organizationId_fkey" FOREIGN KEY ("draftId", "organizationId") REFERENCES "AdCampaignDraft"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignAudit" ADD CONSTRAINT "AdCampaignAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
