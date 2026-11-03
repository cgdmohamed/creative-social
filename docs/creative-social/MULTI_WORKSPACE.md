# Phase 1: multiple workspaces

Based on the fetched `main` revision
`6022ea209429108318e76c724c47e794df4ecad1` (2026-11-03, Asia/Riyadh).
Branch: `feature/multi-workspace`. No deployment or merge was performed.

## Behavior and existing architecture

- The existing OrganizationSelector is always visible, including with one
  workspace. Its keyboard/touch-accessible menu reuses `/user/organizations`,
  `/user/change-org`, the modal manager and form button. It exposes creation,
  administrative name editing and a link to the existing Settings > Teams UI.
- Authenticated, activated users may create an independently owned workspace
  regardless of their role in another workspace. This does not elevate their
  permissions in that other workspace. Impersonated sessions cannot create.
- `POST /user/organizations` accepts `{ "name": "Client name" }`. Name is trimmed,
  1–80 characters, with control characters and angle brackets rejected. User,
  owner role, API key, trial and subscription fields are never taken from input.
- The organization, unique encrypted API key and existing-user SUPERADMIN
  membership are created atomically. Schema defaults initialize all other fields.
  No user registration, content copy, paid subscription or repeat trial is created.
- `MAX_WORKSPACES_PER_USER` defaults to `10`, counting active organizations with
  the user's SUPERADMIN membership, including their initial workspace. `0`
  disables additional creation. Invalid quota values deny creation. The user's
  PostgreSQL row is locked while checking the quota and creating the workspace,
  serializing competing creation requests. Existing access is never removed when
  changing the limit. Production/staging Compose pass this backend setting.
- Creation returns only `{ id, name }`. The UI immediately uses the existing
  switch endpoint. Only a successful switch navigates to the dashboard with a
  full document load, discarding prior workspace caches, editors and resource
  URLs. If switching fails after creation, the dialog offers switching again
  without submitting another creation request.
- `POST /user/change-org` now verifies active membership before writing the
  selection cookie/header. The existing authentication middleware already rejects
  foreign, deleted and disabled selections without silently falling back.
- `POST /user/organizations/name` edits only the current authenticated workspace.
  The database write requires the caller's active ADMIN/SUPERADMIN membership.
  The route was added because the inspected baseline had no workspace-name edit
  endpoint to reuse. Existing membership and invitation implementations are reused.
- These three write endpoints reject foreign browser origins. Cookie-authenticated
  browser requests require Origin matching FRONTEND_URL's origin. Originless
  non-browser clients must provide the existing explicit `auth` header.
- Team listing/invitations/removal explicitly enforce administrator access even
  in self-hosted mode, whose existing plan guard otherwise bypasses role checks.
  SUPERADMIN membership cannot be removed through team-member removal. No owner
  transfer or workspace deletion feature is added.

## Tenant boundaries reviewed

Authentication resolves the account from storage and chooses only its active
organization memberships. Organization IDs supplied in creation/rename bodies
cannot select a victim workspace. Creation never attaches existing channels,
posts, media, Inbox rows, reports, subscriptions or credentials to the new one.

Existing social account reads constrain organizationId; post-group reads constrain
the selected organization. Existing Inbox synchronization/replies, reporting
snapshots/collection jobs, OAuth grants and scheduler tests remain in the combined
suite. They continue to use their explicit organization context rather than a
user's newly selected cookie. Switching does not move or cancel scheduled jobs.

A discovered post-editor media lookup used only the media ID. It now resolves
stored IDs with the post's organizationId and deletedAt=null, drops foreign IDs,
and fails closed if resolution errors instead of returning unverified metadata.
Internal processor repository reads retain their existing separate workflow.

**Public media URLs remain public publishing assets.** Workspace-scoped library
records and credentials are isolated; this does not convert the public uploads
gateway or externally hosted image URLs into private, signed asset storage.
There is no PostgreSQL row-level-security layer or claim that every unrelated
inherited route has received a comprehensive security audit.

## Data and operational compatibility

No Prisma changes or database migrations are necessary. No existing users,
organizations, memberships or database volumes are removed, reset or rewritten.
An account already owning more than the configured limit keeps those workspaces;
only additional creation is denied. Names need not be globally unique: IDs remain
the identity. Per-workspace subscriptions and channel limits retain existing
behavior; this phase does not implement agency-wide consolidated billing.

Use the current GHCR publishing workflow and frontend environment allowlist on
main. Do not revert to the earlier Coolify app-image build setup. One stale
deployment test was updated to assert this current GHCR/revision behavior and
explicitly blank frontend credentials, preserving the recent safety fixes.

## Validation and acceptance

- `pnpm run lint:workspace`: 0 errors, 0 warnings across changed application code
  and new tests. The existing repository-wide legacy lint backlog is outside this
  change; no rules are disabled or broadly suppressed.
- Combined Jest: **150 tests / 16 suites passed**, including 38 new workspace
  cases and the previous 112 Inbox/Reporting/auth/OAuth/scheduler cases.
- Deployment Jest: **18 tests / 1 suite passed** after updating stale assertions.
- Backend, frontend and orchestrator `tsc --noEmit --incremental false` passed.
- Production and staging Compose configuration validation passed; no services ran.

Workspace tests execute transaction/foreign-key rollback and concurrent quota
cases in ephemeral PGlite through a small repository SQL adapter. They also check
name validation, nested ownership, unique API keys, active-account gating, roles,
origin checks, switch-cookie authorization, DTO validation, IDOR-resistant rename,
media scoping, social credentials/content boundaries and UI failure/retry behavior.
Controller tests invoke actual controller methods and Nest ValidationPipe;
frontend tests use a DOM environment and mocked HTTP responses. These are not a
full browser-to-live-PostgreSQL or Temporal deployment test.

Before release, manually exercise two workspace owners and a regular member on an
isolated instance: create/switch, connect different test social accounts, schedule
separate posts, check library/Inbox/report views, rename/invite/remove, revoke an
active membership in a second session and retry a stale selection. Stress quota
locking against real PostgreSQL, including transaction timeout behavior. Verify
HTTP Origin/cookies under the actual reverse proxy. Real Meta API/App Review,
live publishing and container startup were not validated in this phase.

Remaining limitations: new UI labels are English; no workspace deletion/ownership
transfer, agency billing or private asset gateway is provided. If a creation
response is lost at the network boundary, inspect the switcher before resubmitting;
the server does not yet accept a creation idempotency key.
