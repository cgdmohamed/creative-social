# Phase 3: paid advertising analytics and client reports

Merged reporting infrastructure, extended by the consolidated release. All
collection remains read-only and independent from the campaign execution flag.

## Application behavior

The **Advertising Analytics** navigation item opens `/advertising-analytics`.
It includes overview, campaigns, ad sets/ad groups, ads, previous-period
comparisons, KPI cards, spend trends, entity tables, CSV/PDF downloads, client
assignment, sync status and scheduled client reports. Workspace members may read
and export; ADMIN/SUPERADMIN members may change account reporting settings,
request synchronization and manage schedules. Provider access remains read-only.

Manual synchronization supports the current advertising account-local day. The
Today control selects that day for the chosen account. Open-day snapshots are
provisional, retain provider latency warnings and are never presented as closed
complete periods. `PAID_INTRADAY_SYNC_ENABLED=true` adds current-day collection at
15-minute intervals when `PAID_ANALYTICS_SYNC_ENABLED=true`; both default off.
`PaidSyncJob.startedAt` distinguishes a collection started before midnight from a
collection started after period close. A later clock date alone cannot promote
an open-day collection to complete. Scheduled freshness-required reports demand
closed current and comparison coverage. CSV/PDF include provisional status.

Email schedules require a configured sender/provider and an active workspace
member recipient. Delivery progresses from QUEUED to PROVIDER_ACCEPTED only when
Temporal returns a positive SMTP/SES/Resend acceptance receipt. Completion without
a receipt or failed sending becomes UNCONFIRMED, not delivered. Provider acceptance
does not prove inbox delivery. Ambiguous email sends are not automatically retried;
artifacts remain downloadable through authenticated tenant-scoped routes.

Organic reports keep their own routes, types, snapshots and metric registry.
The only shared PDF change extracts the existing offline Chromium render method;
the original organic `render(report)` still renders the same organic HTML. Paid
exports reuse the existing Postmill-attributed HTML/CSV escaping helpers.

The dashboard does **not** present a cross-provider grand total. Each account,
currency, timezone and observed attribution context has its own group. Queries
select one reporting level; account totals are never added to campaign/ad totals.
Campaign filtering requires campaign/ad-group/ad level, not account level.

## Metric definitions and compatibility

| Metric | Definition / limitation |
| --- | --- |
| Spend | Native account currency; Google cost_micros is divided by 1,000,000 using Decimal, not floating-point money arithmetic |
| Impressions / clicks | Provider counters; explicit zero stays zero |
| Reach | Meta exact-period unique reach cache or a single daily entity row; never summed across dates or entities. Generic Google unique reach is unavailable for this resource set |
| CTR | Total clicks / total impressions × 100 |
| CPC / CPM | Spend / clicks; spend / impressions × 1,000 |
| Conversions | Meta `omni_purchase` only; Google `metrics.conversions` (provider primary conversions). These definitions are intentionally different |
| Conversion rate | Conversions / clicks × 100. This is explicitly click-based, not Google's interaction-based UI rate |
| CPA | Spend / the conversion definition above |
| Leads / CPL | Meta `lead` action only; Google primary `SUBMIT_LEAD_FORM` category conversions. These are action counts, not deduplicated people; CPL = spend / those leads |
| Purchase value | Meta matching `omni_purchase` action value; Google primary PURCHASE-category conversion value. Google total conversions_value is retained separately, not mislabeled as purchase revenue |
| ROAS | Purchase value / spend, only with explicit workspace-admin verification of value tracking and available purchase values. Fixed-value Google purchase actions suppress ROAS |

Ratios are recalculated from summed numerators and denominators, never averaged
from daily percentages. Zero/negative denominators produce unavailable ratios,
not infinity. Missing fields, sparse all-zero provider responses and missing
conversion categories are not silently turned into zero values. Negative source
adjustments can be retained. Exact numeric strings are used in API/CSV exports;
charts convert only for visual coordinates. No currency conversion is performed.

Comparisons use the immediately preceding inclusive interval of equal length.
Percentage change is unavailable with a zero/negative or unavailable baseline;
the API also supplies absolute change. Empty or partially observed periods are
marked rather than presented as complete source data.

### Attribution and conversion settings

Meta requests explicit 7-day click plus 1-day view windows and impression-date
reporting. It selects one canonical action type instead of adding overlapping
purchase aliases or attribution-window columns. Provider-modeled/estimated data
and privacy thresholds still apply; no cross-provider deduplication is attempted.

Google uses interaction-date primary conversion metrics. Purchase/lead-category
queries retrieve **only conversion metrics** and join to base daily rows; their
rows never multiply spend, clicks or impressions. Current conversion-action
counting rules, click/view lookbacks, attribution models, primary flags and
fixed-value settings are captured during collection. A stable fingerprint links
daily snapshots to those observed settings stored once on the collection job.
Changed settings produce separate report groups. Preserve completed job metadata
when retaining historical snapshots. Settings are observed at collection time,
not a reconstruction of historical per-event configuration. Custom campaign goals
may override action primary flags; provider primary metrics remain authoritative.

PDFs identify the attribution context/fingerprint and window summary. CSV carries
the complete observed context on the first row of each group and its fingerprint
on all rows, avoiding excessive repeated metadata. The dashboard also exposes it.

Official references: [Google conversion reporting](https://developers.google.com/google-ads/api/docs/conversions/reporting),
[Google metrics reference](https://developers.google.com/google-ads/api/fields/v26/metrics),
[Google conversion-action settings](https://developers.google.com/google-ads/api/reference/rpc/v26/ConversionAction),
[Meta Insights parameters](https://developers.facebook.com/docs/marketing-api/insights/parameters/).
Meta documentation access failed during research; verify the chosen API version,
reporting windows, fields and actual permissions using test accounts before release.

## Synchronization and historical storage

Paid collection runs on the backend, where Phase 2 Ads credentials remain. No Ads
credentials are added to the frontend or orchestrator. The internal Phase 2
`readForReporting` boundary refreshes credentials/cooldowns and gives a read-only
collector a transient token callback; tokens are never returned in report DTOs.

- Durable PostgreSQL jobs divide date ranges into at most 31-day daily requests.
  Manual synchronization includes both selected and previous periods. Meta reach
  uses separate exact-period jobs after daily coverage exists. Google reach is
  not fabricated.
- The automatic sweep visits connected, selected accounts in batches. Initial
  collection covers at least 28 days. The rolling overlap is configurable, default
  30 days, to refresh delayed/adjusted conversions. Choose a lookback sufficient for
  the actual attribution lag, up to 93 days, and manually refresh older periods
  when necessary. This does not promise late revisions outside that window are
  automatically rediscovered.
- Only completed account-local calendar days are collected. SQL DATE values
  represent provider calendar dates; source days are not rebinned into server UTC.
  Currency/timezone metadata is checked against the provider before collection.
  Changed currency/timezone contexts cannot overwrite the old context's rows.
- Composite-key upserts replace refreshed values rather than add them. Duplicate
  provider rows abort the job. A complete refresh clears omitted old values to
  unavailable, not invented zero. Legacy Ads contract rows remain in storage but
  are excluded from paid-v1 calculations because their definitions are unknown.
- Lease tokens, attempt limits, retry delays, connection revisions, administrative
  membership rechecks and consistent connection→account lock order coordinate
  replicas and disconnections. The collector commits a slice and its completion
  marker atomically. A failed/partial provider pagination never commits coverage.
- Limits: ten accounts per manual sync, 1–93 days per selected report period, 100
  accounts / 20,000 raw rows per report, 20 provider pages per request and a
  60-second provider deadline. Narrow dates/accounts/level when limits are hit.
  Campaign filters apply to stored reports; collection reads the account's whole
  selected level. Very large accounts need further partitioning/async Meta reports.

Client IDs are validated against the current workspace. Existing snapshot client
ownership is retained when an account is reassigned; newly observed dates use its
current assignment. Backfilling previously unobserved history therefore needs a
correct assignment first. Mixed-client reach is not assigned to one client.
Client filters are reporting groups, **not an extra per-client ACL**: workspace
members can read workspace data. Use separate workspaces for client access isolation.

Coverage means the date slice was fetched successfully, not that every metric was
available or that conversions are final. Freshness requires completed coverage,
an active error-free connection and collection within 48 hours. Previous coverage
is reported separately. Stale/disconnected historical reports remain readable.

## Exports and scheduled reports

CSV exports retain all bounded entity details, native units, definitions, previous
values, coverage and last sync. HTML escaping and spreadsheet-formula protection
are reused. PDFs include KPI comparisons, freshness, definitions and the first
100 entities per group with an explicit truncation notice; CSV is the full detail.
Exports are capped at 10 MiB. The shared local Chromium renderer blocks scripts
and network requests and retains its sandbox.

Schedules are configurable for 1–93 rolling days, daily/weekly/every-30-day cadence,
CSV/PDF, private archive or email link, and whether complete recent current and
comparison coverage is required. The API accepts an explicit first run; the UI
starts one minute after saving. Periods end on the earliest completed local date
among selected accounts, preserving a common date range without incomplete days.
Schedules use UTC instants for due times and skip missed-cadence catch-up storms.

Generated artifacts are private database bytes, never public uploads. Downloads
require an active membership in the artifact's organization. Recipients must be
active workspace members. An email contains only a generic authenticated download
link; switch to the relevant workspace before opening it if another is selected.
There are no public signed links, external-recipient attachments or webhook delivery
in this phase. Downloaded client-ready PDFs/CSVs can be shared manually as appropriate.

Archive is the default and does not enqueue email. Email requires the existing
EMAIL_PROVIDER configuration and Temporal `main` email worker. Delivery uses a
stable run workflow ID with REJECT_DUPLICATE. The UI says QUEUED, not delivered;
later SMTP/workflow failures require existing Temporal monitoring. External email
receipt and exactly-once SMTP delivery are not claimed. Generation/queue failures
are recorded, and a queue failure preserves an already generated download.

The creator's current administrative access and recipient membership are rechecked.
Schedules can be edited/paused. A changed schedule or lost lease cannot overwrite
another worker's result. Limits are 20 schedules per workspace and two due jobs
per scheduler tick. Private artifacts/jobs are retained; plan database capacity,
backups and an approved retention policy before enabling recurring production use.

## Configuration and upgrade

1. Review/merge Phase 2 separately and configure its dedicated developer apps,
   encryption key, permissions and callbacks. No new OAuth scope is requested here.
2. Review/back up the database, then apply
   [005-paid-analytics.sql](migrations/005-paid-analytics.sql) once after upgrades
   001–004. It adds paid jobs, reach, schedules and runs plus nullable/defaulted
   snapshot metadata; existing rows and organic tables are preserved. New empty
   installs use the full schema instead of replaying additive upgrades. No reset,
   automatic db push, destructive down migration or live migration is performed.
3. Build the reviewed source and validate schema drift. Existing production uses
   the Creative Social GHCR/Coolify pipeline, which is preserved.
4. Backend runtime flags, default off in both Compose examples:
   `PAID_ANALYTICS_SYNC_ENABLED=false`, `PAID_REPORT_SCHEDULES_ENABLED=false`.
   Set `PAID_SYNC_LOOKBACK_DAYS=30` (1–93) to suit actual attribution delay. Enabling
   paid collection starts real read-only provider requests; enabling report
   schedules can queue email if explicitly configured. Operators enable these
   only after isolated acceptance testing. No flag was enabled on a server here.
5. PDF uses existing REPORT_CHROMIUM_EXECUTABLE_PATH. Email uses existing
   EMAIL_PROVIDER/SMTP or supported email-provider variables and the Temporal main
   queue. Archive/CSV generation does not require SMTP. This task sends no messages.

## Verification and remaining acceptance work

Automated tests cover normalization, fractional conversions, micro-currency,
timezone/DST dates, canonical actions, attribution changes, null/zero math,
weighted calculations, sync deduplication/rollback/leases, stale connections,
client moves and reach ownership, RBAC/IDOR/Origin validation, exports, schedule
freshness and mocked email queueing. Nest HTTP tests use real middleware and DTO
validation with fixture storage. Migration/catalog/FK tests use ephemeral PGlite.
Provider responses and email delivery are mocked, not live Meta/Google/SMTP tests.

Verified on 2026-11-03 with the pinned Node 22 toolchain:

| Check | Result |
| --- | --- |
| Combined integration suites, including existing organic/Inbox tests | 258 passed across 24 suites |
| Deployment safety tests | 23 passed |
| Paid implementation, navigation and modified supporting files ESLint | 0 errors, 0 warnings |
| Backend standalone TypeScript; frontend Next TypeScript | Passed |
| Prisma validation/client generation and ephemeral migration/catalog tests | Passed |
| Production and staging Compose configuration | Passed |
| Sequential production build: frontend, backend, orchestrator | Passed (exit 0) |

The PR records the final sequential production build result. Repository-wide
legacy lint was not rerun or claimed clean. Intermediate build attempts were
superseded after preserving a stale Next cache and regenerating Prisma following
schema changes; only the final build is used for acceptance.
Before production: validate real Meta Insights and Google resource compatibility,
privacy/modeling omissions, actual action/goal configurations, purchase values,
quotas and late adjustments on test accounts; exercise multi-replica PostgreSQL
leases, real Chromium sandbox/PDF layout, database growth/restore and Temporal email
failures on an isolated instance. Performance Max and other resource-limited
campaigns may not provide ad-group/ad rows; missing data stays unavailable.

No live OAuth/API approval, delivered email, production readiness, deployment,
automatic merge, database-volume deletion or production data reset is claimed.
