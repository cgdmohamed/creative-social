-- Creative Social additive upgrade; back up the database before applying.
-- For existing Postiz databases (no Prisma migration baseline required).
BEGIN;
CREATE TABLE "InboxItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "authorName" TEXT,
  "authorId" TEXT,
  "content" TEXT NOT NULL,
  "permalink" TEXT,
  "parentId" TEXT,
  "postId" TEXT,
  "postText" TEXT,
  "postUrl" TEXT,
  "payload" JSONB,
  "happenedAt" TIMESTAMP(3) NOT NULL,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "isOwn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboxItem_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InboxItem_integrationId_externalId_kind_key" ON "InboxItem"("integrationId", "externalId", "kind");
CREATE INDEX "InboxItem_organizationId_kind_happenedAt_idx" ON "InboxItem"("organizationId", "kind", "happenedAt");
CREATE INDEX "InboxItem_integrationId_kind_idx" ON "InboxItem"("integrationId", "kind");
CREATE INDEX "InboxItem_integrationId_postId_idx" ON "InboxItem"("integrationId", "postId");
CREATE TABLE "InboxSync" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxSync_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboxSync_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InboxSync_integrationId_kind_key" ON "InboxSync"("integrationId", "kind");
CREATE INDEX "InboxSync_organizationId_idx" ON "InboxSync"("organizationId");
COMMIT;
