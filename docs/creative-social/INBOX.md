# Unified Inbox

## Scope and attribution

The Comments and Messages pages port Eryk Kruk's inbox implementation from
`erykkruk/postiz-app`, `buzzin/v2.10.1-comments`. All thirteen source commits
listed in PORTING_PLAN.md were applied with `git cherry-pick -x`; the original
authors and source SHA trailers remain in history. Source remains under the
repository's AGPL-3.0 license. Retain LICENSE and attribution when distributing
or hosting modified versions, and make corresponding source available as required.

Compatibility was checked against Postiz upstream `main` at
`4d13c6a2a84796ea5000baf08459417ec015ef3d` (also Creative Social `main`
when fetched on 2026-11-02). The source series targets v2.10.1; this base uses
Temporal orchestration, Next 16 and newer pending publishing contracts.

Compatibility changes against this branch's Postiz:

- Preserve pending publishing contracts and resumable YouTube upload workflows.
  Name the inbox send contract `sendInboxMessage` to avoid colliding with the
  current Telegram provider's private publishing helper.
- Retain current Prisma models and add InboxItem/InboxSync instead of replacing the schema.
- Move the removed cron application's inbox task into the backend with Nest Schedule;
  coordinate backend replicas with an organization-specific Redis lease.
- Use the existing shared Graph API version, split Instagram's stored Page/user
  token pair, and request messaging permissions for Facebook Login.
- Keep the final source commit's inbox threading/repository changes. Its PostStat,
  PostStatDay, post statistics controller and statistics modal dependencies belong
  to analytics work and were excluded. A tenant-scoped inbox post-thread endpoint
  is provided at `/inbox/channels/:id/posts/:postId/comments`.
- Validate mutation DTOs and kind parameters. Check organization/channel ownership
  before replying or moderating. Re-read conversations and enforce the 24-hour
  customer-initiated reply window before sending a private message.

## Configuration and API permissions

No new secrets are introduced. Existing environment variables are required:

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection for inbox items, threads and read state |
| REDIS_URL | Cache and sync leases; retain the existing deployment Redis configuration |
| FACEBOOK_APP_ID / FACEBOOK_APP_SECRET | Facebook Login for Pages and linked Instagram professional accounts |
| FRONTEND_URL / BACKEND_INTERNAL_URL / NEXT_PUBLIC_BACKEND_URL | Existing OAuth callbacks and frontend/backend routing |

Confirm the exact callback paths in the existing provider configuration and reconnect
existing channels after permissions are approved. Scope changes do not upgrade old tokens.

Facebook comments use `pages_read_engagement` and `pages_manage_engagement`;
reading user content can additionally require `pages_read_user_content`, depending
on the content and app access. Messenger conversations require `pages_messaging`,
`pages_manage_metadata`, and `pages_read_engagement`, plus a Page token issued to
someone with MESSAGING or MODERATE tasks. Instagram via Facebook Login needs
`instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`,
and `pages_manage_metadata`, plus an appropriate Page token for a linked
professional account. This provider does not use the separate Instagram Login
`instagram_business_*` permission family. App Review/Advanced Access and business
verification may be necessary for customers outside app roles.

Sources: [Meta Conversations API collection](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a),
[Meta Send API collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api),
[Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

Only text replies to existing conversations are implemented. Replies outside the
standard 24-hour window are rejected; message tags, proactive outreach, attachments,
HUMAN_AGENT extensions and consumer Instagram accounts are not implemented.
Meta remains the final authority on permitted actions. Never bypass App Review.
The direct Instagram login provider and other providers without inbox contracts
show unavailable capabilities instead of attempting unsupported API calls.

## Database upgrade

This Postiz tree uses `prisma db push` and has no migration baseline. For an
existing database, review and apply the additive SQL in
`migrations/001-unified-inbox.sql` once after taking a backup. It creates both
inbox tables, indexes and cascading Integration foreign keys in one transaction.
Do not initialize Prisma migrate history from this file. For a fresh development
database, the existing `pnpm prisma-db-push` command includes the new schema.
Run `pnpm prisma-generate` after upgrading. The SQL has not been applied to production.

## Synchronization and operations

Backend instances register an hourly task at minute 7. A Redis lease prevents
concurrent scheduled sync of the same organization across replicas. Each channel
has a 90-second caller timeout. A timeout stops waiting but cannot cancel requests
already running inside existing provider retry logic. Manual Refresh runs a sync
immediately. Data is served from PostgreSQL; permissions/token failures appear
per channel, and the last successful sync time remains unchanged on failure.

This first version fetches recent publications (10 per channel), comments (provider
limit), and recent conversations (25 threads, 25 messages per thread). The panel
returns up to 500 locally stored items. It is a bounded recent inbox, not a complete
historical archive. There are no webhooks or retention/erasure policy jobs yet.
Own replies are stored with threads. Read state is shared by the organization;
a conversation becomes unread again when its latest activity advances.

## Validation

`pnpm test:inbox` runs the HTTP integration suite with real Nest controllers,
request validation, IntegrationService and InboxRepository, replacing external
providers and the Prisma transport at their boundaries. The two suites cover 13 cases, including provider API/token normalization. They test sync, database
reads, read-state persistence, tenant isolation, reply ownership, unsupported
providers, input validation, platform failures and server-side messaging windows.
It does not prove live Meta approval or sandbox behavior. Sandbox authorization,
real database upgrade, and end-to-end UI checks remain required before production.

### Results on 2026-11-02

- `pnpm test:inbox`: **13 passed**, using pinned Node 22.23.4 / pnpm 10.6.1.
- `tsc --noEmit -p apps/frontend/tsconfig.json --incremental false`: **passed**.
- `tsc --noEmit -p apps/backend/tsconfig.build.json --incremental false`: **passed** after renaming the inbox send contract to avoid Telegram's private helper.
- Complete workspace `pnpm build` (frontend, backend, orchestrator): **passed** with pinned Node 22.23.4 / pnpm 10.6.1. Individual frontend/backend builds also passed with Node 24.22.1.
- Prisma 6.5 schema validation and client generation: **passed**.
- Additive SQL executed on embedded PostgreSQL (PGlite); duplicate-key rejection and both Integration cascading foreign keys: **passed**.
- Targeted lint: **blocked before file analysis** by the existing root FlatCompat/Next configuration (`TypeError: Converting circular structure to JSON`). The pinned ESLint 8.57.0 and Next 16 configuration are incompatible; this port does not change the shared lint configuration.
- Live Meta sandbox authorization, approval, comments/DM delivery and browser end-to-end testing: **not performed**, requiring test accounts and approved app access. Docker's PostgreSQL daemon was unavailable; no existing deployment database was changed.

Standalone type checks used the available bundled Node 24.22.1 runtime; the Inbox test suite and complete workspace build were also run successfully with the repository's exact Node/pnpm pins.


## Combined develop integration

See [STAGING.md](STAGING.md) for combined migration order, opt-in collection flags,
Coolify candidate configuration and remaining staging/live API validation.
