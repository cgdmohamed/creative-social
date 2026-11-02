# Creative Social client analytics and reports

Task 2 lives on `feature/analytics-reports`, independently of Inbox PR #1.
Open `/reports` in the application to select clients, channels and dates, compare
adjacent periods, inspect observed daily history, create post-based reporting
campaigns, and export CSV or PDF. Reports read PostgreSQL rather than calling
platform APIs when viewed. Data collection is disabled by default pending real
provider validation.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing PostgreSQL database; apply the reporting migration before running the feature. |
| `REDIS_URL` | Existing Redis instance for distributed per-channel collection leases. |
| `REPORTING_COLLECTION_ENABLED` | New opt-in flag. Only the exact value `true` enables scheduled collection and manual queue requests. Default is disabled. Restart the backend after changing it. |
| `REPORT_CHROMIUM_EXECUTABLE_PATH` | New optional absolute path to an operator-managed Chromium/Chrome executable. Enables PDF export; JSON/CSV do not require it. |
| Existing provider credentials and OAuth configuration | Existing Postiz Facebook/Instagram/YouTube app credentials and channel tokens are reused; no new scopes are requested by this module. |

A Linux deployment can point the PDF variable at its installed Chromium binary.
Install fonts needed for client languages (including Arabic) in that environment.
Use an unprivileged user with functioning Chromium sandbox support; this port
never automatically supplies `--no-sandbox`. PDF rendering is limited to two
concurrent browsers per backend instance and has explicit launch/page/PDF timeouts.
The template is local and escaped, JavaScript is disabled, CSP disallows remote
assets, and request interception aborts network loads. No shell commands or URLs
are accepted from report users.

Existing permissions include Facebook `read_insights` / `pages_read_engagement`,
Instagram insights permissions for the selected Facebook Login or standalone
Instagram Login flow, and YouTube `youtube.readonly` / `yt-analytics.readonly`.
These are descriptions of existing provider configuration, not verified App Review
or live-account access. Reconnect channels if permissions are missing. No live
credentials were used during this port; validate official API access and metric
responses in a sandbox before enabling collection in a real deployment.

## Database upgrade

Review `migrations/002-analytics-reports.sql`. It is a transaction containing only
new reporting/Ads tables, enum types, foreign keys and supporting indexes, plus
composite unique indexes on existing Integration/Post identity and organization.
It was generated with Prisma 6.5 from main's schema and has no dependency on Inbox
migration 001. Apply it **once** against a backed-up database, then regenerate
Prisma Client (`pnpm prisma-generate`). This repository uses db push and has no
Prisma migrate baseline; do not treat this file as a new baseline for existing tables.
Fresh development databases can use the existing `pnpm prisma-db-push` workflow.
No database upgrade or deployment was performed outside the test database.

If Inbox PR #1 is merged later, consolidate ScheduleModule.forRoot registration
and review shared schema/API-module changes normally. Do not merge PR #1 merely
to use this reporting branch.

## Collection and history

When enabled, the backend sweeps organizations at minute 23 each hour (UTC), and
polls durable manual collection requests every 30 seconds. The manual endpoint
returns 202 promptly. Requests survive backend restarts in PostgreSQL; the worker
re-checks current client ownership before collecting. Redis leases coordinate
scheduled/manual work and replicas, and request-key-aware acknowledgement cannot
remove a newer request. Worker concurrency is two channels, with bounded batches.

Collection uses the existing provider token refresh flow. It refreshes up to seven
calendar days of eligible channel observations for late corrections. It samples
20 published root posts per channel page, ordered by keyset cursor, from the last
180 days or any active reporting campaign. The cursor continues on later sweeps;
one failed post cannot starve the rest. Each platform call has a 20-second caller
timeout and each post page has a collection budget. Existing provider retries
cannot always be cancelled after that timeout. No successful data is overwritten
with synthetic zeroes on permission failures; status is stored without raw token-
bearing error URLs.

Supported collection adapters: Facebook Pages, Instagram through Facebook Login,
standalone Instagram and YouTube, subject to what the existing official-API
provider methods actually return. Other platforms show collection unavailable.
Instagram rolling channel totals are intentionally excluded from daily history.
Post counters can still be sampled where the API supports them. "Organic content"
means content reporting outside the Ads connectors, not a promise that provider
counters exclude promoted activity. Reports explicitly disclose platform-total
traffic and do not mix in paid Ads facts.

Post lifetime history starts at observation time. It cannot be reconstructed
retroactively from current counters. Old posts need boundary observations before
period growth can be known. Date labels preserve provider calendar days; lifetime
samples use UTC observation days. Client-local/account-timezone conversion and
full historical backfill are not implemented. Current-day readings are provisional.

Reports allow 1-400 inclusive days, up to 50 channels and 500 posts. Campaigns
contain up to 200 published root posts from one client (or unassigned channels).
Manual requests contain up to 10 channels. Snapshot reads are bounded to 100,000
window rows plus 10,000 baselines; oversized requests fail clearly rather than
silently truncating totals. Metadata lists up to 1,000 channels and the first 200
campaigns; narrow the client selection for larger portfolios. A campaign is a
reporting-only grouping, not Postmill's full campaign-management hub.

Readings are retained at daily granularity; no retention deletion or weekly
rollups are introduced in this slice. Plan backups, privacy/erasure operations and
retention before large deployments. Hard deletion of an integration cascades its
reporting facts; soft-deleted posts/channels are excluded from ordinary report
selection. Client ownership is immutable for each first daily observation; when
an integration is reassigned, historical facts do not move to the new client.

## Endpoints and testing

Authenticated organization APIs:

- `GET /reports/options`, `GET /reports/posts`
- `GET /reports/organic?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=CHANNEL|POST`
- `GET /reports/organic.csv`, `GET /reports/organic.pdf` with the same filters
- `POST /reports/campaigns` with name, client, dates and published post IDs
- `POST /reports/sync` with selected integration IDs; returns queued statuses

Optional query filters are `customerId`, comma-separated `integrationIds` and
`campaignId`; `customerId=__unassigned` selects unassigned attribution. Campaign
reports always use post scope and their approved membership. The UI uses stored
campaign dates as defaults, while API callers must provide explicit dates. Export
and JSON responses are private/no-store. CSV formula payloads are neutralized.

Run `pnpm test:reports` with Node 22.23.4 / pnpm 10.6.1. The six suites contain 53 tests and cover metric
semantics, missing baselines/gaps, signed corrections, input validation, tenant
isolation, campaign scoping, collector fairness, durable requests, worker ownership
checks, PostgreSQL migrations/queries/precision, CSV safety and HTML escaping.
HTTP tests run real Nest validation/controllers/services with provider/repository
boundaries stubbed; database tests execute the real migration and repository
snapshot/baseline methods against PGlite PostgreSQL through a test transport.
DOM/SVG component tests cover client filtering, historical channel selection and operator capability flags; their test-only environment omits jsdom's unused native Canvas peer. They do not prove a production Prisma-to-server connection, a complete browser session, or live OAuth access.

`REPORT_CHROMIUM_EXECUTABLE_PATH=... node tests/reporting/pdf.smoke.cjs /absolute/path/sample.pdf`
runs the actual renderer with synthetic, labelled demo observations, without live
platform calls. The sample includes Arabic names, wrapping and multiple pages.

Validation results and remaining blockers are recorded in the separate pull request.
Live Meta/YouTube account validation, real deployment migration rehearsal, and
browser-to-backend end-to-end testing remain required. Meta Ads / Google Ads have
schema and adapter contracts only, not working live connectors. Nothing was deployed.

## Verified results - 2026-11-02

- **PASS:** `pnpm test:reports` - 53 tests in six suites, pinned Node 22.23.4 / pnpm 10.6.1. No platform API traffic; provider boundaries are mocked.
- **PASS:** frontend and backend standalone TypeScript checks. The full build also type-checked the final implementation.
- **PASS:** complete `pnpm build` - frontend, backend and orchestrator using the pinned toolchain. An initial build with stale generated cache stalled; the clean-cache retry and final build completed successfully.
- **PASS:** Prisma 6.5 schema validation and client generation; actual PostgreSQL migration/constraint/snapshot/baseline tests through PGlite.
- **PASS:** actual Chromium renderer smoke test produced a two-page A4 PDF. Both pages were rendered with Poppler and visually inspected, including Arabic text, multi-page tables, zero-valued observations and missing-data notices.
- **BLOCKED:** targeted lint fails before file analysis with the unchanged root FlatCompat/Next configuration (`TypeError: Converting circular structure to JSON`, ESLint 8.57.0). No clean file-level lint result is claimed.
- **NOT VERIFIED:** live Meta/Instagram/YouTube permissions and metric responses; real Meta Ads/Google Ads collection (not implemented); deployment PostgreSQL migration rehearsal; complete authenticated browser-to-backend workflow.

Collection stays opt-in and disabled by default. Main and PR #1 were not modified
or merged, and no production deployment was performed.


## Combined develop integration

See [STAGING.md](STAGING.md) for combined migration order, opt-in collection flags,
Coolify candidate configuration and remaining staging/live API validation.
