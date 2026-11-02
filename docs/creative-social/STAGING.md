# Combined Inbox and Reporting integration / Coolify staging

Status: candidate configuration and local integration verification only. No deployment,
production access, live Meta requests or Coolify control-plane changes were performed.
The Docker daemon is unavailable on the development host, so Linux image build, boot,
Chromium sandbox, TLS/proxy behavior and worker polling still require staging validation.
Do not enable automatic deployment for this branch during review.

## Branches and attribution

`develop` starts at main `4d13c6a2a84796ea5000baf08459417ec015ef3d` and retains
merge commits for PR #1 (`feature/unified-inbox`) and PR #2
(`feature/analytics-reports`). The integration review targets
`review/develop-integration`, a separate branch anchored at that same main commit.
Main is not a PR target and is unchanged. The feature PRs remain unmerged into main;
Inbox remains pending real Meta validation.

Keep LICENSE, the source attribution in [INBOX.md](INBOX.md),
[REPORTING.md](REPORTING.md), and [ANALYTICS_AUDIT.md](ANALYTICS_AUDIT.md), original
commit history and AGPL source availability. The staging image retains source and
license files. If providing network access, provide users the corresponding source
for the exact deployed revision under the AGPL, including local modifications.

## Environment

Start with `deploy/coolify/staging.env.example`, whose values are synthetic and
cannot serve as a real deployment configuration. Never commit actual environment
files or reuse production credentials, databases, uploads, Redis or Temporal queues.

| Variable | Purpose |
| --- | --- |
| `STAGING_URL` | Dedicated HTTPS origin without trailing slash; required at image build and runtime. A domain change requires rebuilding Next public variables. |
| `STAGING_REVISION` | Reviewed immutable commit SHA used as the local image tag. |
| `STAGING_DB_PASSWORD` | Unique URL-safe PostgreSQL password; compose derives DATABASE_URL for the private database. |
| `STAGING_JWT_SECRET` | Unique random secret, at least 64 characters. |
| `STAGING_TEMPORAL_ADDRESS` | Required reachable **isolated staging** Temporal endpoint. No production cluster/namespace. |
| `STAGING_TEMPORAL_NAMESPACE` | Pre-provisioned namespace, default `creative-staging`; worker and API must match. |
| `STAGING_TEMPORAL_TLS`, `STAGING_TEMPORAL_API_KEY` | Match the isolated Temporal service. For TLS mode, provision the `organizationId` and `postId` Text search attributes separately; the app skips registering them. |
| `DISABLE_REGISTRATION` | Defaults true. Bootstrap an initial staging account only during an access-restricted, explicitly approved setup window, then disable registration. |
| `INBOX_COLLECTION_ENABLED` | Defaults false. Exact `true` enables Inbox live reads, sync, replies, moderation, message sending and hourly collection (minute 7 UTC). Stored Inbox reads and read markers work while disabled. |
| `REPORTING_COLLECTION_ENABLED` | Defaults false. Exact `true` enables report collection requests and scheduled workers (minute 23 hourly and a 30-second request worker). Stored reports/CSV/PDF remain usable. |
| `STAGING_FACEBOOK_APP_ID`, `STAGING_FACEBOOK_APP_SECRET` | Optional isolated test-app credentials forwarded to Facebook OAuth variables. |
| `STAGING_INSTAGRAM_APP_ID`, `STAGING_INSTAGRAM_APP_SECRET` | Optional isolated test-app credentials for Instagram Login. |
| `REPORT_CHROMIUM_EXECUTABLE_PATH` | Set to `/usr/bin/chromium` inside the candidate image. A host install can use a local Chrome path. |

Compose sets `MAIN_URL`, `FRONTEND_URL`, `NEXT_PUBLIC_BACKEND_URL`,
`BACKEND_INTERNAL_URL`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_PROVIDER=local`,
`UPLOAD_DIRECTORY=/app/uploads` and `NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads`.
Leave `NOT_SECURED` unset for HTTPS cookies. Do not expose internal services publicly.
Other providers remain optional; configure only isolated test accounts using
[.env.example](../../.env.example). Meta Ads / Google Ads are extensible data models,
not implemented live advertising collectors.

## Database upgrades

No automatic `prisma db push`, destructive reset or migrations run on application
startup. The combined schema uses manual additive SQL because main has no Prisma
migration baseline. Keep already published migrations 001 and 002 unchanged.

Apply exactly once, in this order, to a **backed-up isolated staging database**:

1. [001-unified-inbox.sql](migrations/001-unified-inbox.sql)
2. [002-analytics-reports.sql](migrations/002-analytics-reports.sql)
3. [003-inbox-tenant-constraints.sql](migrations/003-inbox-tenant-constraints.sql)

002 adds Integration's `(id, organizationId)` unique key. 003 depends on that key
and replaces Inbox's single-channel foreign keys with composite tenant/channel
foreign keys, matching Reporting's tenant boundaries. Existing mismatched ownership
causes 003 to fail transactionally; investigate and repair ownership before retrying.
It never deletes or silently reassigns rows. Run these diagnostics before 003:

```sql
SELECT x.id, x."organizationId", i."organizationId" AS "channelOrganizationId"
FROM "InboxItem" x JOIN "Integration" i ON i.id=x."integrationId"
WHERE x."organizationId" <> i."organizationId";
SELECT x.id, x."organizationId", i."organizationId" AS "channelOrganizationId"
FROM "InboxSync" x JOIN "Integration" i ON i.id=x."integrationId"
WHERE x."organizationId" <> i."organizationId";
```

For an existing Inbox-only staging database, apply 002 then 003. For a
Reporting-only database, apply 001 then 003. Record applied filenames and checksums
in the staging change log; the SQL scripts intentionally fail on accidental reapplication.
Use `psql -v ON_ERROR_STOP=1 -f <migration>` via a private administrative connection.

For a new empty database, first create **main's baseline**, then the three upgrades.
The following prepares the baseline locally; apply it only after staging approval:

```sh
git show 4d13c6a2a84796ea5000baf08459417ec015ef3d:libraries/nestjs-libraries/src/database/prisma/schema.prisma > /tmp/creative-main.prisma
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel /tmp/creative-main.prisma --script > /tmp/creative-main.sql
# After approval, use a private staging connection for psql -v ON_ERROR_STOP=1 -f ...
```

After upgrades, verify zero drift against the merged schema with Prisma 6.5.0
(`migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel
libraries/nestjs-libraries/src/database/prisma/schema.prisma --exit-code`), and
run `pnpm run prisma-generate`. Never apply 001/002 after initializing the *merged*
schema with db push, as their objects would already exist. Roll back application
images only after reviewing schema compatibility; restore a tested database backup
for schema rollback rather than deleting reporting or Inbox tables.

## Coolify setup after explicit approval

Use a new **Docker Compose** resource for this repository/reviewed commit, with
`deploy/coolify/compose.staging.yaml`. Build context resolves to the repository root;
Dockerfile is `deploy/coolify/Dockerfile.staging`. Use dedicated staging volumes and
a separate private Temporal service accessible from this resource. Pin infrastructure
images to reviewed digests before running (candidate tags are not immutable).

The candidate launches non-root Node containers for API, frontend and orchestrator;
the gateway serves shared uploads read-only. App containers start compiled entrypoints
directly, avoiding the legacy PM2 script that automatically runs db push. Chromium
runs with its normal sandbox; do not bypass sandbox failures with `--no-sandbox`.

Associate only gateway port **8080** with the staging HTTPS domain in Coolify.
The proxy sends `/api/*` to backend port 3000 with the prefix stripped, everything
else to Next port 4200, and serves `/uploads/*` from the staging volume. Forwarded
HTTPS and WebSocket headers are included. PostgreSQL, Redis, API, frontend and
workers have no published host ports. Restrict gateway access to the Coolify proxy.

Health checks live in the Compose file, as required for Compose resources by
[Coolify's Compose documentation](https://coolify.io/docs/services/configuration/docker-compose).
The gateway health endpoint checks gateway liveness only. API `/` checks API
liveness; neither proves database correctness, provider access or Temporal polling.
See also [Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks).

After approval, bring up only private database/Redis first, apply the reviewed
baseline/upgrades, then start apps and gateway. Before accepting staging:

- Verify backups and migration checksums/drift; verify PostgreSQL and Redis health.
- Confirm Temporal namespace, search attributes, API connection and orchestrator pollers.
- Test HTTPS login/cookies, two organizations and two clients, Inbox/Reports navigation,
  denied cross-organization requests, read markers, CSV, PDF Arabic text, uploads and restart persistence.
- Keep both collection flags false initially. Validate disabled Inbox writes return 503
  while stored reporting and Inbox still work.
- Test PDF launch under the actual non-root container/sandbox and review resource limits.
- Only then separately authorize test-app collection and perform real Meta OAuth,
  permissions, comments, messaging-window, reply/moderation and metric checks. Record
  actual app review status/scopes, account types, timestamps and results.

Do not promote this candidate automatically or connect production social accounts.
Read [INBOX.md](INBOX.md) for provider limitations/permissions and
[REPORTING.md](REPORTING.md) for metric semantics and incomplete collection behavior.

## Reproducible local checks

Pinned Node 22.23.4, pnpm 10.6.1, Prisma 6.5.0:

```sh
pnpm install --frozen-lockfile
pnpm run prisma-generate
pnpm run lint:integration
pnpm run test:combined
pnpm exec tsc --noEmit -p apps/backend/tsconfig.json
pnpm exec tsc --noEmit -p apps/orchestrator/tsconfig.json
pnpm run build
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
docker compose --env-file deploy/coolify/staging.env.example -f deploy/coolify/compose.staging.yaml config --quiet
```

`test:combined` runs both feature suites plus a full-schema PGlite migration test
using main's pinned Git object (requires a full-history checkout). It compares columns,
defaults, enums, indexes and constraints against the merged schema, executes real
repository writes/read markers through SQL adapters, and rejects cross-tenant rows.
The combined HTTP fixture registers both controllers and tests disabled Inbox live
access alongside stored client reports. HTTP auth injection/provider boundaries are
fixtures, not live authentication/Meta API validation. PGlite is PostgreSQL WASM,
not proof of a successful migration on the future hosted PostgreSQL instance.

Run `pnpm run lint` for the entire repository. The shared configuration now loads
ESLint 9 and Next's native flat config rather than circular FlatCompat. Existing
repository-wide rule violations are tracked in INTEGRATION_VALIDATION.md; they are
not hidden by turning rules off globally. CI gates the integration scope, combined
tests, API/worker types and the production build. No deployment step was added.
