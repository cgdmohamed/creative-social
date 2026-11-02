-- Integration upgrade: apply after 001 and 002. Existing mismatches fail validation;
-- inspect and repair their ownership manually before retrying. No rows are deleted.
BEGIN;
ALTER TABLE "InboxItem" DROP CONSTRAINT "InboxItem_integrationId_fkey";
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_integrationId_organizationId_fkey"
  FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxSync" DROP CONSTRAINT "InboxSync_integrationId_fkey";
ALTER TABLE "InboxSync" ADD CONSTRAINT "InboxSync_integrationId_organizationId_fkey"
  FOREIGN KEY ("integrationId", "organizationId") REFERENCES "Integration"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
