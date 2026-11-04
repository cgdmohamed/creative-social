# Phase 4: Advertising Campaign Manager

Based on merged Phases 1–3, main `ba3e7c1d9`. Open `/advertising`.

## Supported in this release

- Read campaigns, ad sets/ad groups and ads through official Meta Graph and Google
  Ads search endpoints, using existing workspace-selected advertising accounts.
  Pagination is bounded and overflow fails explicitly instead of hiding rows.
  Google ad IDs include ad group identity, matching Phase 3 reporting keys.
- Create, edit and duplicate **local** campaign drafts. One campaign, one ad set/
  group and one creative/ad are planned per draft. Drafts are never submitted by
  jobs, timers or saving a form. Creation keys are stable per request; conflicting
  key reuse fails. Editing requires a matching revision and invalidates reviews.
- Meta traffic (`OUTCOME_TRAFFIC`), lowest-cost link clicks, country targeting,
  automatic or Facebook Feed placements and account-currency daily budgets.
  Generated campaign/ad-set/ad creation plans use PAUSED throughout. Image plans
  reference an authorized Page and an existing account-owned image hash; neither
  ownership nor validity is inferred from typing an ID.
- Google Search responsive search ad plans: manual CPC, maximum CPC, exact-match
  keywords, country selections, Google Search only, separate non-shared budget,
  paused campaign/group/ad, atomic `partialFailure: false`, `validateOnly: true`.
  Country geoTargetConstant resolution is a blocker, not a fabricated mapping.
  Proposed calendar dates are shown in the advertising account timezone; Google
  campaign dates cannot enforce requested intraday UTC start/stop times.
- Workspace image/video selection through the existing Media library. The builder
  offers escaped text previews and a local asset reference, not an official
  rendering or a provider upload. New uploads use the existing `/media` interface.
- Local proposals to pause/resume existing campaigns, with account ownership
  verified against a fresh provider campaign list when requesting review. Source
  status and observed provider budget units appear beside the proposal.
- Immutable review snapshots with canonical SHA-256 digests, exact typed account/
  currency/daily-budget/schedule confirmation, 15-minute expiry, owner approval or
  rejection, and transactional workspace audit history. An expired/rejected review
  requires editing the draft to obtain a new revision and review.
- Campaign performance links initialize the Phase 3 account/campaign/level filters.
  The paid metrics and organic reporting calculation paths are unchanged.

## Safety boundary and unsupported features

**Provider execution is not implemented/enabled in this release.**
`POST /campaign-manager/reviews/:id/submit` always returns HTTP 423 with
`LIVE_AD_WRITES_DISABLED`. `APPROVED_BLOCKED` means approved local intent; it does
not mean a provider accepted, created, paused or resumed anything. No environment
variable or browser parameter can enable writes. No mutation transport is
registered. Google POST requests used for listing are GAQL search reads.

The Phase 2 Meta grant remains `ads_read`; this change does not request production
permissions or upgrade it silently. Future Meta writes need explicit
`ads_management` approval/reconnection and appropriate Page/asset access. Google
uses its existing adwords OAuth scope, but this application still blocks writes.

Unsupported provider execution includes creation, pause/resume, budget/date/bid
updates and asset uploads. Existing `UPDATE` drafts can retain a client's proposal
but have an explicit unsupported-plan blocker. No raw provider JSON is accepted.
There is no hidden automatic retry. A future write executor must persist provider
IDs at every Meta step, reconcile ambiguous timeouts before retrying, validate
Google requests before atomic commit, check fresh permissions and approval state,
and never infer success from a network timeout.

Other unsupported workflows:

- Meta sales, leads, awareness, app, engagement, catalog, dynamic creative,
  Advantage+, special-ad-category and political campaigns; custom/lookalike
  audiences, pixels, custom conversions, interests, age/gender exclusions and
  arbitrary placement combinations. Empty `special_ad_categories` in the example
  plan is not authorization to advertise restricted categories.
- Google Performance Max, Display, Video, Shopping, Demand Gen, app campaigns,
  automated/portfolio bidding, shared budget edits, extensions/assets, conversion
  goal changes, negative keywords, audiences, location exclusions, ad schedules and
  geoTargetConstant discovery. Google Search is a campaign type, not a claim that
  provider conversion goals were configured.
- Provider image/video uploading, processing/polling, official preview URLs,
  destination crawling and policy appeal. Video can be organized locally but is
  not included in these image/Search request plans.
- Cloning existing provider campaigns into another account. Duplication copies
  local drafts and clears existing campaign IDs/approval; provider assets are not
  copied or assumed portable.
- True delivery/billing eligibility, delivery forecasts, spend caps and provider
  policy approval validation. Displayed provider approval is informational; a
  campaign-level status cannot guarantee every child ad is approved.

Daily budgets are not total campaign spend caps. Provider overdelivery rules apply.
Meta and Google currency minor units and Google micros are handled separately;
invalid precision and currency changes fail. Country syntax validation does not
claim provider eligibility. Google country resolution and date semantics must be
resolved before any future live execution. Resume needs a fresh reconciliation of
campaign and child budgets/statuses; the local proposed budget must never replace
that step in a future write implementation.

## Permissions and isolation

Active workspace members may list resources, previews, drafts, reviews and history.
ADMIN/SUPERADMIN may create/edit/duplicate drafts and request reviews. Only
workspace SUPERADMIN may approve/reject. A workspace owner may approve their own
draft; this release does not require two distinct people. These are workspace
roles, not global system administrator privileges. Existing JWT middleware and
fresh membership queries enforce access. Cross-origin cookie writes and all
impersonated writes are rejected.

Composite database foreign keys bind drafts to the workspace account and reviews
to the workspace draft. Account tokens stay within the existing internal encrypted
credential boundary and never enter campaign DTOs, plans, audit rows or browser
responses. Provider errors expose bounded codes rather than raw token-bearing
responses. Lists use no-store responses. The UI remounts when switching workspace,
and discards in-flight resource results after account/tab changes.

Audit rows record actor, workspace, action, draft/review identifiers and a bounded
reason/digest, not tokens. No audit editing/deletion API exists. The UI shows the
latest 200 events and 100 drafts/reviews/assets/accounts; provider listing is
bounded to 20 pages (Google additionally 20,000 rows). There is a 100-draft workspace
quota. There is no automatic retention/deletion process; operators must plan
database retention and archive UX before high-volume use.

## Database and staging

No new secrets, external services, queues or environment variables are required.
Apply `docs/creative-social/migrations/006-advertising-campaign-manager.sql` after
001–005 during an explicitly approved, backed-up staging upgrade. It creates three
tables, indexes and foreign keys transactionally; it drops/modifies no existing
business tables or data. Generate Prisma with the repository's pinned version.
Do not run db push/reset or remove any database volumes.

Staging acceptance: verify cross-workspace listing, media selection, owner/admin/
member behavior, concurrent revision conflicts and expired/revoked access against
real PostgreSQL; inspect actual provider list/policy responses on authorized test
accounts. All automated provider tests are mocked. No live ad spend, production
API mutation, permission upgrade, merge or deployment is part of this work.

## Official references and attribution

This implementation uses the existing Creative Social/Postiz architecture and
AGPL licensing. No third-party SDK code was copied.

- [Google bulk mutations and validate-only](https://developers.google.com/google-ads/api/docs/mutating/bulk-mutate)
- [Google responsive search ads](https://developers.google.com/google-ads/api/docs/responsive-search-ads/create-responsive-search-ads)
- [Meta official SDK campaign example](https://github.com/facebook/facebook-python-business-sdk/blob/main/examples/AdAccountCampaignsPostCategories.py)
- [Meta official SDK ad resource and execution options](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py)

## Verification (2026-11-04)

- Combined suites: 319 tests passed across 28 suites, including existing Inbox,
  organic reporting, workspace, advertising connection and paid analytics tests.
- Campaign lint and the eight modified supporting files: zero errors/warnings.
- Standalone backend and frontend TypeScript checks passed.
- Final sequential production build passed (exit 0): Next frontend, Nest backend
  and Temporal orchestrator.
- Prisma schema validation/client generation passed. Ephemeral PGlite applies all
  six migrations, compares the generated schema catalog, preserves old data and
  checks cross-workspace/duplicate campaign draft and review constraints.
- New provider tests use mocked HTTP only. Nest endpoint tests run real auth
  middleware/validation on localhost with fixture storage; they do not contact
  Meta/Google. UI tests verify role gates, confirmation, draft-save idempotency,
  workspace resets and paid analytics links.

The first cached Next build was interrupted after it stopped making progress; its cache was moved
to a workspace backup, preserved intact, before a fresh-cache retry.
Repository-wide legacy lint was not rerun or claimed clean. Real PostgreSQL
multi-process locking, live provider responses/permissions, official creative
previews and all provider mutations remain unvalidated or unsupported as listed
above. No production readiness or live API validation is claimed.
