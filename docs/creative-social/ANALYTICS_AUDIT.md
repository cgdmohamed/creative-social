# Task 2: Postmill analytics and report port audit

Branch: `feature/analytics-reports`, created directly from Creative Social `main`
(`4d13c6a2a84796ea5000baf08459417ec015ef3d`). This branch contains no Inbox
commits and does not depend on PR #1. PR #1 must remain unmerged pending real Meta
validation. No main changes, merge, deployment, or live analytics API calls were made.

## Source and attribution

Audited `postmill-ai/postmill-app` main at
[`564569110b267562a21bc662a8d30ea77786ea6e`](https://github.com/postmill-ai/postmill-app/tree/564569110b267562a21bc662a8d30ea77786ea6e).
The analytics/campaign foundation is embedded in the initial snapshot
`aedd01d2e929af0c3e5265c957a8a18d8183217f` (author: postmill-ai,
`297530775+postmill-ai@users.noreply.github.com`). Later changes include package-scope
rename `94776f62d0f203a99479f2599269350635f1e64a` and Puppeteer migration
`17b9284c888238b6583cfa9cd63f97e6a2740076`. Both repositories use AGPL-3.0.

A full commit cherry-pick would import unrelated AI/media/provider-registry and
Inngest architecture. This is a selective port: source references remain in file
headers, this audit, and commit trailers. Root LICENSE is retained. The original
Postiz attribution is unchanged. Distributions must retain these notices and
LICENSE; operators exposing modified software over a network must offer its
corresponding running source under AGPL, including their deployment changes.

## Inspected implementation and decisions

| Postmill source | Finding | Decision in this port |
| --- | --- | --- |
| `src/integrations/social/analytics.metrics.ts` | Canonical labels, stock/flow kinds, provider label maps | Port the registry with source notice. Restrict collection to audited current adapters; do not advertise every registry provider as supported. |
| `src/analytics/analytics-aggregation.ts` | Pure comparisons, stock/flow aggregation, post-counter baselines | Adapt percentage change. Implement explicit FLOW/STOCK/LEVEL/AVERAGE rules. Unlike the source's zero-default/clamped post deltas, missing boundary baselines stay unknown and negative corrections remain signed. |
| `src/database/prisma/analytics/analytics.repository.ts` | Daily unique snapshots and PostgreSQL DISTINCT ON baselines | Adapt the schema, idempotent daily updates and parameterized baseline queries. Add immutable client attribution, original channel names, composite tenant foreign keys and bounded reads. |
| `src/inngest/activities/analytics.activity.ts` | Canonicalization, seven-day channel reads, post snapshots, keyset batching, freshness/retention work | Adapt collection over this Postiz's existing providers and token refresh. Exclude unsafe rolling totals rather than fabricating daily history. Use bounded 20-post pages and advance past failed posts to prevent starvation. |
| `apps/backend/src/inngest/functions/analytics-collection.ts`, `analytics-backfill.ts` | Daily durable fan-out, retries, org/integration concurrency, backfill events | Do not import Inngest or its run registry. Use Nest Schedule, per-channel Redis leases and durable PostgreSQL manual requests. No post-lifetime backfill is claimed. |
| `src/analytics/analytics.service.ts` | Retention and daily-to-weekly rollups; default raw daily channel retention is 548 days | Do not port rollups in this slice. Persist actual daily history with bounded report queries; do not mix weekly points with daily comparisons. Operators must plan retention separately. |
| `src/database/prisma/campaigns/campaign-report.service.ts` | JSON/CSV/PDF composition; campaign item inventory, goals, synced social comments; Puppeteer 25 | Adapt safe CSV cells and the report-to-browser-PDF pattern. Build a separate, client-scoped reporting campaign over published posts. Do not import Inbox, AI inventory, notes, goals or public sharing. |
| `src/database/prisma/campaigns/campaign-report.html.ts` | Escaped HTML, comparison tables, channel breakdown | Adapt escaping and report structure, with local-only content, coverage notes, trends, repeated table headers and pagination. |
| `src/analytics/date-range.validation.ts` | Required ranges and a 400-day resource cap | Retain the cap, add strict real-calendar UTC day validation and equal adjacent comparison windows. |

Source paths above are under `libraries/nestjs-libraries/` unless prefixed with
`apps/`. These reusable reporting foundations do not require AI designer, video
rendering, media editing, AI narration, provider credentials configuration hub,
watchlists, anomalies, social Inbox, billing changes, or storage-provider modules.
None of those modules were copied.

The Eryk analytics candidates in the earlier port plan were also inspected. They
rely on the old cron app, `postStats()` contracts and/or Inbox tables. They were
not applied on this independent main-based branch; current Postiz already exposes
`analytics()` / `postAnalytics()`, which this port adapts instead.

## Compatibility and metric semantics

- Current Postiz uses Temporal for publishing and has no old cron app. Publishing,
  provider OAuth flows, and Temporal workflows are unchanged. Reporting schedules
  are encapsulated in a new backend ReportingModule.
- Facebook's current `Page followers` label represents daily follows, not an account
  follower stock. Its `Page Impressions` label now comes from media unique-view
  metrics; this port names it daily media reach and never calls the summed period
  a unique audience. Media totals can include promoted content.
- Current Instagram channel likes/views/comments/shares/saves/replies are returned
  as one `total_value` over the entire requested window. These are excluded from
  daily storage. The daily reach/follower series remain eligible; post lifetime
  counters are sampled separately. No seven-day total is written as one day's activity.
- YouTube channel averages retain units and unweighted-average semantics. Existing
  native methods sometimes swallow errors and return an empty list; this is reported
  as no usable observations rather than proof of zero performance.
- Post lifetime values are stored on their observation day, not their publication
  day. Period changes require a real reading on the immediately preceding day, or
  a legitimate zero-at-publication baseline for posts published inside the window.
  Unknown gaps are not interpolated. Daily deltas require adjacent observations.
- Signed counter corrections are retained. Missing values are null, not zero.
  A comparison is suppressed if either window lacks complete boundary/daily coverage.
  Percentage metrics compare in percentage points; count metrics use relative change.
- Client ownership and channel display name are captured at collection. Reassignment
  does not rewrite old snapshots. Client reports query only that client's stored
  observations and may include former channels for historical reads. Old-client
  requests cannot collect new-owner data. Historical calendar attribution before
  the first collection is not recoverable from the current integration assignment.
- Channel/report API reads are organization scoped; composite foreign keys enforce
  organization consistency for snapshots and campaign post membership. Customers
  are report groupings, not a new per-member ACL system: existing authenticated
  organization members retain the existing Postiz access model. There are no public
  report links or new cross-organization permissions.

## Dependencies

- Runtime addition: `puppeteer-core@25.8.0` (Postmill uses full Puppeteer). It fits
  the repository's Node 22.23.4 pin and does not download a browser. The operator
  supplies a compatible local Chromium executable. No remote HTML, scripts, fonts,
  images or arbitrary URLs are accepted by the renderer; Chromium sandboxing remains on.
- Test-only addition: `@electric-sql/pglite@0.5.14` for real PostgreSQL schema/query
  tests without requiring Docker. The test command uses Node's VM-modules flag for
  PGlite's dynamic imports under Jest 29.
- Existing Nest Schedule, Redis, Prisma 6.5, class-validator, React and Postiz provider
  libraries are reused. No Inngest, AI/media or Ads SDK was added. The lockfile is
  updated with pinned pnpm 10.6.1 and contains additions rather than unrelated upgrades.

## Paid reporting extension boundary

`AdReportingAccount`, `AdReportingDailyMetric`, and `AdsReportingAdapter` are
contracts only. Accounts default disabled. Models separate Meta Ads / Google Ads,
organization/client ownership, external account/entity IDs, account timezone,
currency, reporting level and attribution window. Spend/conversions use fixed
precision decimals and counters use BigInt. A future credential reference is not
an OAuth token. Organic snapshots are not reused for paid facts.

There are no Ads OAuth, API collection, spending or campaign-management endpoints.
Do not aggregate levels, currencies, timezones, or attribution windows together.
Connector authorization, API version pinning, pagination, quotas, conversion
semantics and live account validation remain future work.

See [REPORTING.md](REPORTING.md) for setup, limits and validation results.
