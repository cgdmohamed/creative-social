# Phase 2: advertising account integrations

Based on merged Phase 1, `main` revision
`91d987559` (squash merge, including the tenant-safe publishing follow-up).
Feature branch: `feature/advertising-accounts`. No deployment or provider
permission request was performed while implementing this phase.

## Scope and workspace behavior

Settings → Advertising Accounts is available to workspace ADMIN/SUPERADMIN
members. It connects Meta Ads or Google Ads, discovers accessible advertising
accounts and saves up to 100 selected accounts per workspace/provider. Account
name, external ID, currency, timezone and last-known availability are displayed.
Organic Facebook/Instagram/YouTube integrations are not reused or modified.

There is one independently authorized connection per workspace/provider and many
account selections on it. A manager can reconnect with a different provider
identity, then discover/select again. Multiple independent grants for the same
provider inside one workspace are outside this phase. The same external account
may be independently authorized in different workspaces; credentials and metadata
are never shared across those workspaces. Duplicate assignment within a workspace
and provider is prevented by the existing database unique key.

This phase discovers account metadata only. It does not collect advertising
performance metrics, create/change campaigns, modify budgets, send conversions,
or add a spending workflow. The existing historical Ads metric contracts remain
available for a later collection phase.

## Required server configuration

Set these runtime variables on the **backend only**, not as Docker build arguments,
NEXT_PUBLIC variables, frontend variables or worker credentials. Both production
and staging Compose examples pass them only to the backend. The current production
frontend environment allowlist also strips automatically injected project secrets.

| Variable | Purpose |
| --- | --- |
| FRONTEND_URL | Existing public HTTPS origin; determines exact OAuth callbacks |
| ADS_ENCRYPTION_KEY | Independent 32-byte key encoded as exactly 64 hex characters; generate with `openssl rand -hex 32` |
| META_ADS_APP_ID | Dedicated Meta advertising app ID |
| META_ADS_APP_SECRET | Dedicated Meta advertising app secret |
| META_ADS_API_VERSION | Explicit currently supported Graph API version, for example the version enabled in your app dashboard; no implicit version is chosen |
| GOOGLE_ADS_CLIENT_ID | Dedicated Google Web application OAuth client ID |
| GOOGLE_ADS_CLIENT_SECRET | Its confidential client secret |
| GOOGLE_ADS_API_VERSION | Explicit supported REST version; example configuration uses `v26` |

Empty advertising configuration leaves the provider unavailable without disabling
organic publishing. Back up the encryption key separately from database backups.
Keep it stable across deployments. Changing it without a controlled decrypt/reseal
migration makes existing credentials unreadable; reconnect or locally disconnect
remains possible. No automated key rotation or external KMS integration is included.

### Meta developer setup and review

1. Create a dedicated app/use case supporting Facebook Login and Marketing API.
   Keep it separate from the app used for organic integrations: revoking a Meta
   app's user permissions can affect its other grants.
2. Configure the HTTPS site and exact valid OAuth redirect URI:
   `https://YOUR_HOST/settings/advertising/callback/meta`.
3. The connector requests **ads_read**, not ads_management, read_insights,
   business_management, or publishing permissions. Use permitted developer/test
   roles and test ad accounts for initial validation. Confirm the authorizing user
   has access to the intended ad accounts.
4. For external-client access, review Meta's current ads_read Advanced Access,
   business verification and App Review requirements. Prepare the requested demo,
   privacy/data-deletion information and access instructions. Operators submit
   reviews themselves after staging validation; this task submits nothing.
5. Verify the app's current API version and login configuration in the dashboard.
   The code exchanges the authorization code, exchanges its short user token for
   a long-lived one, verifies ads_read was granted, then reads `/me/adaccounts`.
   Expiration follows the response's expires_in. Meta user grants have no OAuth
   refresh_token: the UI requires user reauthorization when expired or revoked.

Official references: [Marketing API authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization/),
[ads_read permissions](https://developers.facebook.com/docs/permissions#ads_read),
[long-lived user tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/),
[accessible ad accounts](https://developers.facebook.com/docs/marketing-api/reference/user/adaccounts/).
Meta's documentation endpoints returned access failures/HTTP 429 during the audit;
the precise current app-review/dashboard flow and live exchanges still require
operator verification. Mocked requests are not proof of Meta approval.

### Google developer setup and review

1. Use a dedicated Google Cloud project and Web application OAuth client. Enable
   Google Ads API, configure the consent screen, appropriate test users and the
   exact redirect `https://YOUR_HOST/settings/advertising/callback/google`.
2. Start with the project's test-account API access. Check its Google Ads API
   Overview page for the appropriate access level when ready for client use;
   complete the applicable brand/OAuth verification and review processes yourself.
   No Cloud project settings or access-level applications are changed here.
3. Google sunset developer tokens on September 9, 2026. API access now follows
   the Cloud project owning the OAuth client. This connector does **not** require
   or send a developer-token header. Some older REST documentation/page summaries
   still describe it; the current developer-token migration and access policy
   pages take precedence for setup.
4. Google Ads uses `https://www.googleapis.com/auth/adwords`. This is a broad scope,
   not an invented read-only Ads scope or Google Ad Manager scope. Use an account
   user with a **read-only Google Ads role**. The connector itself only lists
   accessible customers and runs fixed, read-only GAQL account queries.
5. OAuth requests offline access, explicit consent and S256 PKCE. A fresh grant
   must return a refresh token. Refreshes preserve the existing refresh token if
   Google does not rotate it. An invalid grant requires reauthorization; external
   consent-screen testing or provider policy can limit token lifetime.
6. Discovery includes directly accessible advertisers and manager descendants,
   deduplicates external IDs and records the manager login-customer-id for a
   selected managed client. Manager containers themselves are not selected as
   advertiser accounts. Validate your actual hierarchy on test accounts.

Official references: [OAuth web-server flow and revocation](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google Ads OAuth](https://developers.google.com/google-ads/api/docs/oauth/overview),
[developer-token sunset](https://developers.google.com/google-ads/api/docs/api-policy/developer-token),
[Cloud-project access/review](https://developers.google.com/google-ads/api/docs/api-policy/access-levels),
[account hierarchy](https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy).

## Security, lifecycle and API contracts

All `/advertising` endpoints are in the existing authenticated-controller list.
The service independently rechecks active administrative membership against the
database, including nondeleted organizations/users. It rechecks after provider
discovery and before committing authorization/selection. Browser writes require
the configured frontend Origin. Writes are refused while impersonating.

| Endpoint | Behavior |
| --- | --- |
| GET /advertising | Safe provider status and selected-account metadata; never credentials |
| POST /advertising/:provider/authorize | Returns the official consent URL with opaque state |
| POST /advertising/:provider/callback | Accepts `{state,code}` or `{state,error}`; consumes state once |
| POST /advertising/:provider/discover | Complete bounded provider discovery, refresh if needed, mark missing selections unavailable |
| POST /advertising/:provider/accounts | `{accountIds:[...]}` replaces selection after fresh provider authorization checks |
| POST /advertising/:provider/disconnect | `{revoke:false}` erases local credentials; `{revoke:true}` also attempts provider grant revocation |

Provider route values are only `meta` and `google`. Workspace/user IDs come from
authentication, not request bodies. OAuth state is random, hashed in storage,
bound to user/workspace/provider, expires after ten minutes and is atomically
consumed. The Google verifier is encrypted. Switching workspace during consent
does not transplant the grant; return to the starting workspace and restart if
authorization cannot complete. A new flow invalidates that user's previous one.

Credentials are AES-256-GCM envelopes with random nonces and tenant/provider AAD.
Tokens never enter browser responses or application error messages, and provider
requests put them in headers/form bodies rather than URLs. The callback removes
code/state from browser history and has no-referrer metadata. Configure external
proxy/APM logs to redact authorization headers and callback code/state queries;
no changes to those external systems were performed here.

Connection revisions prevent an in-flight callback, discovery, refresh or selection
from restoring a disconnected/replaced grant. A database refresh lease coordinates
on-demand refreshes across replicas; expiry allows recovery from a crashed caller.
No Redis key storage, Temporal workflows, polling schedules or new runtime service
is needed for this phase. Refresh happens when accounts are discovered/selected,
not as an unsolicited background API call.

Disconnection disables selected accounts and erases access/refresh tokens while
retaining relational IDs, account metadata and historical metrics. Provider
revocation is optional and explicitly confirmed: provider app/client revocation
can also invalidate grants in **other workspaces/apps sharing that provider
authorization**. Prefer local disconnect when removing one workspace. Remote
failure returns UNCONFIRMED/UNAVAILABLE, never false success, and does not restore
erased local credentials. A separately revoked provider grant is detected on the
next operation, not by a webhook in this phase.

Rate limits produce a safe RATE_LIMITED code and bounded retry delay. Stored
cooldowns stop immediate repeated discovery; no automatic retry storm occurs.
Transient failures preserve selections/credentials. Authentication/permission
revocation disables selections and requires reconnect. A new successful connection
requires selecting accounts again, since the identity may have changed. Status is
last-known provider availability; token expiration is also displayed.

Discovery is bounded to 20 Meta pages, 50 directly accessible Google roots,
20 pages per Google query, 2,000 discovered Google advertisers and a 60-second
overall discovery deadline (20 seconds per request). An incomplete
or failing discovery fails closed rather than treating a partial list as a complete
authorization result. Very large account hierarchies need an incremental discovery
extension. This phase does not promise discovery works under every provider
account/review configuration without live validation.

## Additive database upgrade

No migration is executed by this change. On an existing installation:

1. Back up and verify the current catalog and applied upgrade history.
2. After the previous 001/002/003 upgrades, review and apply
   [004-advertising-accounts.sql](migrations/004-advertising-accounts.sql) once, using
   an approved maintenance procedure with ON_ERROR_STOP enabled. It is transactional
   and additive; it is not a reset or a blindly repeatable migration.
3. The migration adds AdvertisingConnection and AdvertisingOAuthState, and nullable
   account connection/manager fields plus defaulted provider status. The composite
   foreign key prevents mixing an account's organization/provider with another
   connection. Existing credentialReference values, account IDs and metrics remain.
4. Rebuild the Prisma client and reviewed application image; validate schema drift
   using the existing readiness gate. A brand-new empty database uses the complete
   current schema, so do not replay the additive upgrades after full initialization.

The repository uses explicit additive SQL upgrades, not an established Prisma
migrate deployment baseline. Do not substitute `prisma db push`, reset a volume,
or invent an automatic drop/down migration. The current GHCR/Coolify pipeline is
preserved. No merge, deployment or production infrastructure operation is performed.

## Validation and acceptance record

Automated provider tests use synthetic credentials and mocked HTTP only. Service
tests use a Prisma-shaped in-memory fixture for CAS/lease/failure scenarios. HTTP
tests run real Nest routes, DTO validation and the existing auth middleware on a
local ephemeral listener. DOM tests exercise selection, failed authorization,
revocation warnings and callback replay protection. SQL migration/FK tests use
ephemeral PGlite; they preserve existing account references and metric rows.

Local results on 2026-11-03:

| Check | Result |
| --- | --- |
| Combined Inbox/Reporting/workspace/advertising tests | 208 passed, 20 suites (58 new cases in this phase) |
| Deployment tests | 21 passed, including frontend secret rejection and Compose secret separation |
| Advertising lint | 0 errors, 0 warnings |
| Supporting modified-file lint | 0 errors; 8 inherited Settings hook warnings, also 8 on the fetched main baseline |
| Backend/frontend/orchestrator standalone TypeScript | All passed |
| Complete production build | Passed; frontend, backend and orchestrator |
| Final backend rebuild after empty-account edge fix | Passed |
| Prisma schema validation/client generation | Passed; no live database connection |
| Production/staging Compose configuration | Both passed; no services started |

The first Next compilation stopped making progress with the existing local cache.
Its process was stopped and the cache moved aside intact inside `.next`; the
fresh-cache full build passed. No cache or application data was deleted. Lint
rules were not suppressed; repository-wide legacy lint was not rerun in this phase.

Before release, validate real
PostgreSQL replica concurrency, reverse-proxy cookies/origins, exact provider
callback URLs, Meta App Review/scopes, Google Cloud project access, real manager
hierarchies, early token revocation and actual provider rate-limit responses on
isolated test accounts. No live OAuth, Meta/Google approval, campaign operation,
production access request or container deployment has been claimed.

Remaining scope: no advertising metrics collector, multiple grants per provider
within one workspace, external KMS/automated key rotation, revocation webhook,
background refresh schedule or campaign-management capability. New UI labels are
English. All existing account/content data and upstream AGPL attribution remain.
