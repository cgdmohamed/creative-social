-- Phase 2: additive advertising accounts upgrade. Back up and review before applying.
BEGIN;
-- CreateEnum
CREATE TYPE "AdvertisingConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "AdReportingAccount" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "loginCustomerId" TEXT,
ADD COLUMN     "providerStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "AdvertisingConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "AdReportingProvider" NOT NULL,
    "credentialCiphertext" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "AdvertisingConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastError" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "refreshLeaseUntil" TIMESTAMP(3),
    "retryAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvertisingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertisingOAuthState" (
    "hash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AdReportingProvider" NOT NULL,
    "verifierCiphertext" TEXT NOT NULL,
    "connectionRevision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvertisingOAuthState_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvertisingConnection_organizationId_provider_key" ON "AdvertisingConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AdvertisingConnection_id_organizationId_provider_key" ON "AdvertisingConnection"("id", "organizationId", "provider");

-- CreateIndex
CREATE INDEX "AdvertisingOAuthState_expiresAt_idx" ON "AdvertisingOAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "AdReportingAccount" ADD CONSTRAINT "AdReportingAccount_connectionId_organizationId_provider_fkey" FOREIGN KEY ("connectionId", "organizationId", "provider") REFERENCES "AdvertisingConnection"("id", "organizationId", "provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingConnection" ADD CONSTRAINT "AdvertisingConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingOAuthState" ADD CONSTRAINT "AdvertisingOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
