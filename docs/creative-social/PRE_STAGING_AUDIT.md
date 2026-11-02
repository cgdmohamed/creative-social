# Pre-staging code quality and safety audit

Audit date: 2026-11-02. Fix branch: `fix/pre-staging-audit`, created directly from
`develop` at `81a871438ad2db9456d4e7cbc86d584c7095d9e6`.

This is a source review and local regression-test result, not deployment approval,
a penetration test, a real OAuth/Meta integration test or certification of every
legacy feature. No production database, infrastructure, main ref or live account
was changed. Collection remains disabled by default.

## Actual lint census and scope

Both runs used Node 22.23.4, ESLint 9.39.5 and the existing native flat config.
The configuration, enabled rules, ignore patterns and existing suppressions were
not weakened. No new eslint-disable directive was added. No mass autofix or
repository-wide formatting was performed.

| Result | Before | After |
| --- | ---: | ---: |
| ESLint errors | 134 | 128 |
| ESLint warnings | 1,109 | 1,102 |
| Files containing errors | 75 | 71 |
| Reviewed P0 lint findings | 0 confirmed | 0 confirmed |
| Reviewed P1 lint errors | 6 | 0 remaining |
| P2 lint errors | 128 | 128 |

Six error diagnostics and seven associated dependency warnings were removed by
behavioral fixes. Remaining warnings were not suppressed to improve these totals.
P0 means a confirmed immediate takeover/cross-tenant compromise/destructive path;
P1 means a confirmed staging-critical credential, tenant, consent, publication or
worker correctness issue; P2 is a bounded follow-up/refactor/test backlog. P2 does
**not** mean harmless, proven safe or unnecessary to fix.

Every original error and warning has an individual record in
[audit/inventory.json](audit/inventory.json), with rule, source position, affected
functionality, priority, source provenance, review/remediation and after status.
[errors.csv](audit/errors.csv) contains all 134 errors, and
[warnings.csv](audit/warnings.csv) all 1,109 warnings. Repeated diagnostics at the
same line remain separate records; nothing was deduplicated out of the census.
[review-notes.json](audit/review-notes.json) records the actual reviewed behavior
and remediation for all 75 error files.

Full portable ESLint JSON snapshots are [before](audit/lint-before.json) and
[after](audit/lint-after.json). Only host-specific paths are normalized; full
diagnostic messages/locations and zero-problem files are retained. The exact rule
counts, source hashes, analyzed-file counts and comparison refs are in
[summary.json](audit/summary.json). Remaining warnings and errors must be reviewed
at their recorded locations before their own fixes, not bulk-converted to hooks
or memoization changes.

## Upstream comparison

Compared both the original Postiz base
`4d13c6a2a84796ea5000baf08459417ec015ef3d` and freshly fetched upstream main
`207eee0dae442a642844c1de9bd7a1574d17c95e`.

All 134 original errors occur in files byte-identical to **both** upstream
revisions after line-ending normalization. Thus these are inherited source
problems exposed by the shared config's restored execution, not Inbox/Reporting
source regressions. This does not mean upstream produced an equivalent clean or
failing lint run: its shared config differs and was not replaced or executed here.
The audit uses explicit source/hash comparisons, not an assumption about upstream CI.

Most warnings also occur in unchanged upstream files. Six warning files differ
from current upstream: the new Inbox component (one image warning), the Creative
Social ESLint config (anonymous export), and touched Facebook/Instagram/YouTube
providers plus upstream-updated Bluesky (one stale disable each). For modified
files the inventory records matching upstream line/context where available;
whole-file modification alone is not treated as proof of a regression.

The behavioral findings below distinguish inherited problems from functionality
introduced by Creative Social. Unrelated upstream invite/Bluesky changes were
compared, not merged into this fix branch.

## Confirmed P1 findings fixed

| ID | Functionality / provenance | Before / resulting behavior | Regression coverage |
| --- | --- | --- | --- |
| F01 | Auth tenant selection; inherited | Invalid, revoked/disabled or malformed explicit organization could fall back to another active membership. Explicit selections now fail closed; only an absent selection can choose a default. No API-key update or handler execution on rejection. | Actual AuthMiddleware: headers/cookies, disabled/foreign/empty/malformed selections, no memberships, valid/default selection, database activation/admin authority over token claims. |
| F02 | Inbox error handling; Creative Social port | Arbitrary provider messages/JSON/URLs could be stored and sent to members, including tokens/private payloads. Only exact application-owned summaries are persisted/served. Existing DB/cache errors are redacted on read too. | Error/string/nested-body cases, stored API output and legacy DB/cache errors exclude synthetic secrets/private text/URLs. |
| F03 | Inbox jobs; Creative Social port | Organization sync fanned out across all channels, cron/manual sync could overlap, refresh could stall before the existing provider timeout, and one failing org stopped the sweep. Add two-channel concurrency, shared channel leases with owner-checked release, 20-second refresh deadline and per-org failure isolation. | Peak concurrency, denied lease, overlapping syncs, timeout/release, foreign channel rejection and continued sweep with safe logging. |
| F04 | Shared API fetch context; inherited | useRef froze destination, credential mode and request hooks. Input-based useMemo now refreshes the context when those actual inputs change. | Rerender changes API destination, credentials and afterRequest hook; old hook is not reused. |
| F05 | Publishing event subscription; inherited | Dynamic dependencies missed callback/enabled changes and could leave stale selection handlers active. Use current callback/enabled with exact cleanup. | Rerender, disable and unmount do not call stale handlers or duplicate listeners. |
| F06 | OAuth consent request identity; inherited | Late validation of app A could populate consent while action parameters refer to app B. Consent state is keyed to the full request, old work is aborted/ignored, parameter errors are derived and fetch dependencies current. | Deferred A/B responses never show A for B; old request aborted; invalid response_type calls no API. |
| F07 | Reporting client/filter identity; Creative Social | A slow earlier report could appear after the client/filter changed. Results are bound to their originating query and only displayed for the current selection. | Deferred report response after client switch cannot appear under the new client. |
| F08 | Composer channel identity; inherited | Cloned/renewed channel objects were treated as missing by reference comparison, silently selecting the first channel. Compare stable IDs, guard empty availability and order callbacks/dependencies correctly. | Selected non-first channel survives cloned objects/list refresh; empty list does not select undefined. |
| F09 | OAuth grant redemption; inherited | Validation/read followed by update(id) let concurrent redemption succeed and could consume a replacement/revoked/expired grant. Both cloud and self-hosted redemption now atomically condition on the exact expected code, expiry and non-revocation; a losing redemption becomes OAuth invalid_grant (400). | Real repository methods via PostgreSQL SQL adapters: one concurrent winner, plus replaced, expired and revoked grant rejection for both grant types. |

F04/F05/F06/F08 account for the six P1 lint errors. F01/F02/F03/F07/F09 were
confirmed during focused behavior review; lint alone did not detect them. Nine P1
findings were fixed; no P0 was confirmed in the reviewed scope.

Tenant filtering was retained in Inbox/Reporting queries and DTO validation,
authenticated controller registration, channel/comment ownership checks,
server-side messaging-window checks, historical client attribution and composite
Prisma foreign keys. The full-main-schema migration comparison remains in the test
suite. Reporting/PDF escaping/network restrictions were retained. No advertising
collector or broad client ACL model was added; organization membership remains the
existing authorization boundary and client filters are reporting/grouping controls.

OAuth server review included registered redirect binding, public-client PKCE,
code expiry, client-secret checking and code consumption; F09 addresses the
confirmed atomicity gap. This is not live third-party OAuth validation. The
inherited long-lived session/token policy and legacy deterministic secret-storage
format need a separate threat-model/backward-compatible migration review, not an
untested format change in this patch.

## Remaining P2 backlog

The individual scope and concrete remediation are in the CSV/JSON inventories;
these groups explain how to tackle them without risky bulk changes:

- Compiled optional Facebook Pixel bundle: 12 this-alias errors and 512 expression
  warnings. Review/rebuild or replace the vendor artifact with provenance/license
  and privacy checks; changing receiver aliases can change callback behavior.
- Hook/compiler compatibility: mount-time provider form initialization, editor
  refs, error-message memos, display state and prop synchronization. Add per-flow
  identity/cancellation/React Hook Form tests, then make targeted lifecycle changes.
  A compiler diagnostic is not by itself a demonstrated runtime exception.
- Optional payment/signup/provider flows: deferred callbacks and one-time network
  operations must not be blindly retriggered by adding dependencies. Trial/checkout,
  activation, wallet/Farcaster and provider-specific options require their own
  sandbox/browser tests before enabling or refactoring those optional paths.
- The unused visibility helper has actual early-return hook ordering, stale page
  dependency and wrong focus-listener cleanup. Search found no call sites, so it
  is P2; repair/test it before adopting it. DOM readiness also never resets its
  found flag on class/root changes. These are recorded defects, not declared safe.
- Media/editor behavior: batch uploader closure mutation and toolbar/ref state
  need concurrent upload, abandoned render and cleanup tests before restructuring.
- Upload module style: five require diagnostics include the legacy Jest preset and
  four file-type interop sites. Node 22.23.4 successfully loads file-type's buffer
  and stream exports. Byte sniffing/allow-lists, stream caps and path containment
  remain present; this import check is not a full malicious-upload test.
- 439 remaining dependency warnings, 65 image warnings, 25 alt-text warnings,
  13 navigation warnings, five incompatible-library warnings, two anonymous-export
  warnings and 41 stale suppression directives remain recorded at exact locations.
  Navigation changes must preserve intentional full reload/cookie and external
  OAuth redirect behavior. Existing suppressions were neither broadened nor added.

## Verification and limits

The final local validation record is [audit/VALIDATION.md](audit/VALIDATION.md).
The original 77 combined tests are retained; added safety tests run in the same
combined suite. New lint:safety covers every changed staging-critical source file
and safety tests, and CI now runs it in addition to integration lint/build/tests/types.
Whole-repository lint intentionally remains failing on the documented P2 backlog;
no green whole-repository lint or complete staging readiness is claimed.

No schema changes or new database migration are required by this audit patch.
Existing upgrades remain 001 -> 002 -> 003; do not reapply them to an already
upgraded database. Only ephemeral PGlite databases were used. Old raw errors are
redacted on read; historical database/log cleanup was not performed.

Redis is required when enabling collection; the in-memory development fallback
is not a substitute for Redis NX/expiry/Lua lease semantics. Provider timeouts
bound the awaited operation; Promise.race cannot cancel underlying upstream
requests, and expired leases/host failures require real Redis/worker rehearsal.

Still outstanding: Docker/Linux image boot and Chromium sandbox, real isolated
PostgreSQL/Prisma migration/backup/drift rehearsal, Temporal namespace/pollers,
authenticated two-org/two-client browser testing, live Meta App Review/OAuth/scopes,
comments/DM windows/analytics quotas and real provider responses. Ads remain
storage/adapter contracts. See [STAGING.md](STAGING.md). Nothing was deployed.
