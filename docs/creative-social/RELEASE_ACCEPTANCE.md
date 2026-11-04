# Consolidated release acceptance and operator runbook

Audited base: main `156b1234c`, 2026-11-04. This document separates implemented code from real-provider acceptance. No live accounts, OAuth credentials, campaigns, server deployments or production databases were used during development. No new PR is created for this consolidated delivery.

## Feature acceptance matrix

“Fully implemented” describes the listed supported workflow, not successful external provider acceptance. “Blocked by external provider configuration” means code exists but permissions/credentials/runtime acceptance must be supplied and verified by the operator.

| Feature / requirement | Initial audit | Release code classification | Verification |
| --- | --- | --- | --- |
| Authenticated multi-workspace creation, atomic defaults, quota, owner membership, switching and member/name management | Fully implemented | Fully implemented | Workspace service/controller/frontend suites; rollback, role and IDOR checks |
| Organic social connections, publishing and Temporal scheduling | Fully implemented | Fully implemented | Existing provider/workflow paths preserved; OAuth grant safety, publishing media/tenant and scheduling regressions |
| Unified Inbox comments/official API messages | Blocked by external provider configuration | Blocked by external provider configuration | Inbox HTTP/repository/provider/job suites pass with mocks; real Meta Page/Instagram permissions and message eligibility still external |
| Organic historical analytics, client PDF/CSV | Fully implemented | Fully implemented | Collector, metrics, SQL, HTTP and UI regressions; shared renderer real-browser smoke |
| Meta/Google OAuth, encrypted credentials, multiple account selection and manager hierarchy | Partially implemented (read-only purpose) | Fully implemented | Explicit workspace management consent added; OAuth CSRF/refresh/revocation/account-isolation mocks |
| Paid account/campaign/group/ad metrics, comparisons, client/date filters, historical snapshots | Fully implemented | Fully implemented | Paid normalization/math/service/HTTP/frontend suites; currencies/timezones/attribution stay separate |
| Current-day paid monitoring and finality | Partially implemented (closed days only) | Fully implemented | Account-local Today; provisional snapshots; collection-start finality and closed-report tests |
| CSV/PDF and scheduled archive/email reports | Partially implemented (queue-only delivery status) | Fully implemented | Strict provider receipts, deterministic workflow IDs, delivery reconciliation and no blind resend; real SMTP remains external |
| Scoped campaign/ad-set/group/ad/creative discovery, policy/status metadata and analytics links | Fully implemented (basic listing) | Fully implemented | Sanitized bounded provider pagination, account-scoped reads, ID keys and UI tests |
| Meta supported objective hierarchy creation and child creation | Missing execution | Fully implemented | Native campaign/adset/creative/ad contracts; paused resources, owned assets/parents, partial failure/recovery mocks |
| Google complete Search creation and child creation | Missing execution | Fully implemented | Official country lookup, atomic validate-only + commit, bids, positive/negative keywords and paused RSA hierarchy |
| Country targeting / Search language behavior | Missing execution | Fully implemented for provider-supported controls | Positive-country edits preserve exclusions; manual Search language targeting unavailable since September 2026, explicitly rejected/explained |
| Image/video provider upload, owned Media use, import, processing and preview | Partially implemented (local Media only) | Fully implemented for supported formats | Binary limits/signatures, configured-storage boundary, role/account checks, upload audit/idempotency and ambiguous-outcome tests |
| Draft editing/duplication, immutable review, approval/rejection and final confirmed submission | Partially implemented | Fully implemented | Revision/digest/expiry/RBAC checks; second confirmation + authorization checkbox + final review; backend enforcement |
| Supported pause/resume, budgets, bids, dates, targeting and ad details | Missing execution | Fully implemented | Separate whitelisted adapters, exact currency units, fresh financial context/shared-budget acknowledgement, atomic Google validation |
| Native Meta deep copy | Missing | Fully implemented | Unique marker, retained parent/child IDs, paused/count checks and conservative UNKNOWN outcome handling |
| Durable mutation ledger, audit, leases/idempotency and reconciliation | Missing | Fully implemented | SENDING persisted before network; confirmed IDs atomic; unknown never retried; explicit recover/abandon; SQL tenant constraints |
| Cross-feature tenant isolation and stored-data preservation | Fully implemented | Fully implemented | Existing suites plus execution/asset composite FKs and upgrade catalog comparison, old metrics preserved |
| Coolify production/staging configuration and migrations | Fully implemented | Fully implemented as configuration | Both Compose configs and deployment tests; no daemon/runtime deployment certification |
| Real-account creation, billing eligibility, policy approval, delivery and performance accuracy | Blocked by external provider configuration | Blocked by external provider configuration | Not claimed tested; consolidated acceptance below required |

Provider-imposed and deliberately unsupported workflows are enumerated in [CAMPAIGN_MANAGER.md](CAMPAIGN_MANAGER.md). There are no fake success responses or hard-coded disabled write transports. Operator defaults intentionally deny execution. The interface distinguishes provider acknowledgement, policy review, delivery and email acceptance.

## Exact configuration reference

Use [.env.production.example](../../.env.production.example) as the complete Compose runtime key inventory (no secrets). [PRODUCTION_COOLIFY.md](PRODUCTION_COOLIFY.md) covers PostgreSQL, Redis, Temporal, storage, JWT, SMTP, pinned images and health gates. [INBOX.md](INBOX.md), [REPORTING.md](REPORTING.md), [ADVERTISING_ACCOUNTS.md](ADVERTISING_ACCOUNTS.md) and [PAID_ANALYTICS.md](PAID_ANALYTICS.md) detail feature-specific settings.

| Setting | Operator requirement |
| --- | --- |
| PUBLIC_URL / FRONTEND_URL | Same real HTTPS origin, no trailing slash. Compose derives FRONTEND_URL. Match the baked public origin; production image workflow currently builds `https://smm.creativecode.com.eg`. |
| CREATIVE_REVISION | Full reviewed main commit SHA whose immutable GHCR image build succeeded; never `latest` or a guessed/unpublished SHA |
| JWT_SECRET, database/Redis secrets | Independent random values; example/startup validators describe minimum length and database hex encoding. Preserve existing credentials on existing volumes. |
| ADS_ENCRYPTION_KEY | Independent, stable 64-hex-character AES key; generate `openssl rand -hex 32`, back up separately, never put in browser/build args/logs. Rotation needs controlled decrypt/reseal or reconnect, not arbitrary replacement. |
| META_ADS_APP_ID / META_ADS_APP_SECRET / META_ADS_API_VERSION | Dedicated Meta advertising app/use case and supported Graph version approved for the app |
| GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_API_VERSION | Dedicated confidential Web OAuth client in a Google Cloud project with Google Ads API enabled and appropriate API access; example version v26. Developer tokens were sunset September 9, 2026 and are not used. |
| ADVERTISING_WRITES_ENABLED | Default `false`. Backend only. Set `true` only after the operator configures/validates accounts and authorizes real API operations; this does not bypass per-workspace management consent or final user confirmation. |
| PAID_ANALYTICS_SYNC_ENABLED | Default `false`; enable read-only paid collection independently |
| PAID_INTRADAY_SYNC_ENABLED | Default `false`; with paid collection enabled, add current account-local day every 15 minutes |
| PAID_SYNC_LOOKBACK_DAYS | 1–93, default 30; choose to cover conversion adjustment lag |
| PAID_REPORT_SCHEDULES_ENABLED | Default `false`; enable after archive/PDF/SMTP/Temporal validation |
| INBOX_COLLECTION_ENABLED / REPORTING_COLLECTION_ENABLED | Default `false`; enable independently after their real API permission checks |
| REPORT_CHROMIUM_EXECUTABLE_PATH | Local sandbox-capable Chromium, supplied by application container. Do not disable the browser sandbox; renderer blocks scripts and network. |
| EMAIL_* / RESEND_API_KEY | Configure the chosen transactional provider and valid sender. Receipt means provider accepted, not recipient inbox delivery. No SMTP sidecar is deployed. |
| INITIALIZE_EMPTY_* flags | Only explicit first-time empty infrastructure initialization. Keep false for upgrades; never reset existing databases or volumes. |

Advertising OAuth redirects (exact, not `/api` routes):

- `https://YOUR_HOST/settings/advertising/callback/meta`
- `https://YOUR_HOST/settings/advertising/callback/google`

Meta default consent is `ads_read`; explicit management consent adds `ads_management,pages_read_engagement`. Grant an authorized user access to the ad account, eligible Page, Pixel/app and assets. External clients may require Advanced Access, business verification and app review for those permissions. Organic/Inbox apps and permissions remain separate. Google uses `https://www.googleapis.com/auth/adwords`, PKCE/state and offline refresh. Its scope is broad; application purpose/role checks enforce read-only behavior until explicit management consent. Configure OAuth brand/testing/production verification and Cloud project API access for the intended real accounts. Manager login-customer IDs come from discovered account hierarchy and stay backend-controlled. See [Google access migration](https://developers.google.com/google-ads/api/docs/api-policy/developer-token).

## Migration and Coolify preparation (no deployment performed)

1. Back up the existing application database, Temporal database, media and encryption/JWT secrets. Verify restoration in an isolated environment. Keep existing volume names and passwords.
2. Establish which additive scripts are already applied. Existing installation upgrades apply only missing scripts in order: `001-unified-inbox.sql`, `002-analytics-reports.sql`, `003-inbox-tenant-constraints.sql`, `004-advertising-accounts.sql`, `005-paid-analytics.sql`, `006-advertising-campaign-manager.sql`, `007-advertising-execution.sql`. Do not reapply scripts or run `prisma reset`, force-reset/db-push, or drop volumes. 007 runs transactionally, adds tables/defaulted columns and does not rewrite existing credentials or metrics. Its FK/index catalog is tested against the complete Prisma schema using ephemeral PostgreSQL-compatible PGlite.
3. The production schema gate validates existing schema and refuses drift; it is not an automatic destructive upgrader. Apply reviewed SQL with an authorized migration role in an approved window, then let the gate verify. New empty installations follow the explicit initialization procedure in the production runbook.
4. In Coolify use the repository, main/reviewed commit, Compose path `/docker-compose.production.yaml`, base `/`, managed Compose mode, automatic deployment off. Configure GHCR access to the immutable repository-built image. A main push may build/publish an image; it does not deploy a server.
5. Set runtime variables from the example, select gateway only for proxy routing, internal port 8080, HTTPS domain matching PUBLIC_URL, HTTP→HTTPS redirect. Do not expose PostgreSQL/Redis/Temporal/frontend/backend host ports or inject runtime secrets as build arguments.
6. Confirm one-shot schema/namespace jobs and long-running health checks, persistence/backup resources, outbound provider network and host capacity in staging. Configuration validation here does not prove a small VPS can run the stack.
7. Enable read collection first. Enable writes only during the explicit owner-led acceptance session below. Disable writes again to stop new mutations; this does not pause existing real advertisements. Pause live resources using explicitly reviewed provider operations first if necessary.

## Consolidated real-account acceptance checklist (NOT executed)

Use operator-owned test/sandbox accounts first. Record actual request IDs, resource IDs, timestamps and screenshots; never record access/refresh tokens. Real-account campaign activation can spend money and needs its own final confirmation.

- [ ] Log in with one user; create Workspaces A/B; switch even with a single initial workspace. Verify owner, ADMIN, USER and outsider permissions, naming/member controls and quota errors.
- [ ] Connect Meta read-only in A; verify state/redirect, account discovery/name/ID/currency/timezone; select intended accounts. Confirm B has independent credentials/selection and cannot access A IDs.
- [ ] Connect Google in A; verify offline refresh, manager-child account discovery/login context and non-manager account eligibility. Confirm refresh/reconnect/revocation statuses without token exposure.
- [ ] Read existing campaigns, groups/sets, ads, assets, budgets, schedules, targets and approval/rejection details. Follow performance links and collect historical/current-day metrics; compare provider UI on the same dates, currency, timezone and attribution.
- [ ] Authorize management explicitly for each provider in A, reselect accounts and confirm old reviews are invalidated. Set the backend operator execution flag only for this session.
- [ ] Meta: upload/import an authorized image and a video; wait for video readiness, select eligible Page and required Pixel/app. Create a supported objective draft with reviewed country/placements/budget/schedule. Validate, approve, separately confirm submission. Verify returned campaign/set/creative/ad IDs in provider UI and PAUSED status at every level. Check policy review rather than assuming approval.
- [ ] Google: create a Search draft with official countries, account-local dates, bid strategy, positive/negative match-type keywords and RSA text/HTTPS URL. Review language limitation. Validate, approve, separately submit. Verify atomic resource IDs, currency micros, criteria and PAUSED campaign/group/ad.
- [ ] Add child sets/groups and ads under the confirmed parents; verify correct ownership and inherited financial context. Test an unauthorized parent/account ID through the API and expect denial.
- [ ] With explicit spend authorization, resume intended parent/child resources after verifying all actual budgets, currency, dates and policy/billing status. Confirm real delivery only from provider evidence. Pause again explicitly and verify provider state.
- [ ] Update only selected fields: budget/bid/end/targeting/keyword/ad content as applicable. Verify untouched fields/exclusions remain. For a shared Google budget, inspect every affected campaign in final confirmation. Verify native Meta copy and all paused child IDs.
- [ ] Exercise a provider validation rejection without spending. Inspect sanitized field errors and audit. In staging inject interrupted-response faults; confirm UNKNOWN blocks resubmission, reconciliation is read-only, recovery reuses confirmed parents, and abandonment retains resources.
- [ ] Collect campaign/group/ad insights for new resources, verify freshness/provisional vs closed status, primary conversions/leads/value verification and null unavailable metrics. Do not sum overlapping levels, reach, different currencies or attribution contexts.
- [ ] Export client CSV/PDF; verify Unicode/layout, formulas escaped, period comparisons, account/client filters and attribution labels. Run an archive schedule and an email schedule; verify authenticated download, provider receipt status and recipient delivery separately.
- [ ] Verify Inbox comment/DM eligibility and organic publishing/scheduling/reporting still work in each workspace. Switch A/B while requests are pending; verify no previous-client rows, assets or credentials remain visible. Test outsider/read-only roles against direct API IDs.
- [ ] Review backups, schema gates, health, resource capacity and external error monitoring before any separately authorized production deployment.

## Automated verification record

The final executed counts/commands are recorded below after the release gates finish. Automated provider responses are mocks, not live Meta/Google validation. Docker Compose validation is structural; no runtime stack or production migration was started.

### Executed release gates (2026-11-04)

- Frozen lockfile validation: `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` passed; lockfile unchanged. Existing installed dependencies used, no secrets or external provider credentials.
- CI lint commands passed: `lint:integration`, `lint:safety`, `lint:workspace`, `lint:advertising`, `lint:paid`, `lint:campaigns`, `lint:deployment`. Integration/safety retain the pre-existing Inbox `<img>` performance warning; no lint rules were disabled or broadly suppressed.
- Combined tests: **373 passed, 35 suites**, using `test:combined` with local Chrome enabled through `RELEASE_TEST_CHROMIUM`. Includes OAuth, tenant isolation, Inbox/organic regression, SQL migration catalog/foreign keys, paid metrics/reporting, campaign transports/execution/approvals/assets/recovery, and actual Chromium PDF output. Provider network responses are mocked. The real-browser smoke uses a separate native Node process because Jest 29 cannot load the ESM-only browser package directly; it runs the actual renderer.
- Deployment tests: **23 passed**. No Docker daemon needed or runtime stack started.
- Production `pnpm run build`: frontend/backend/orchestrator passed. Frontend was rebuilt again after final UI edits and passed. A stale local Next cache stalled an initial attempt; moving only the generated cache aside and rebuilding fresh completed. No source workaround or disabled check was introduced.
- TypeScript: backend and orchestrator passed; frontend passed both its production build check and standalone `tsc --noEmit`. Final backend check repeated after upload guard changes.
- Prisma schema validation passed. Additive scripts 001–007 on the pinned original schema match the full current schema catalog in ephemeral PGlite; old stored account references/metrics survive and cross-workspace execution/asset FKs reject foreign assignments. No production database contacted.
- Production and staging `docker compose ... config --quiet` both passed. Runtime capacity, SMTP, Temporal connectivity in a deployed stack, GHCR image availability for the new commit and real Meta/Google API acceptance remain external checks.
- Repository-wide ESLint: **128 errors / 1,098 warnings**, compared with the previous committed post-audit inventory's 128 / 1,102. All 71 current error-bearing files are unchanged from audited main after line-ending normalization; no errors occur in changed feature files. Exact locations/rules/messages are in [release-lint-findings.csv](audit/release-lint-findings.csv), with [summary](audit/release-lint-summary.json). The previous risk classification/remediation backlog remains in [audit/README.md](audit/README.md), [PRE_STAGING_AUDIT.md](PRE_STAGING_AUDIT.md) and [review-notes.json](audit/review-notes.json). This is not a repository-wide clean-lint claim or a claim that inherited errors are harmless.

Remaining external acceptance blockers: provider apps/permissions and account eligibility, Google Cloud API access/OAuth verification, Meta App Review/business access, actual billing/policy/delivery, production SMTP receipt/inbox validation, staging runtime/capacity and operator-approved production migration/deployment. These were not attempted automatically. No new PR, deployment or live ad change is part of the delivery.
