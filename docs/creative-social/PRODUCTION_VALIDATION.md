# Production deployment validation

Prepared on 2026-11-02–03 from safety-audit commit
`ef0b411415bc37432c2f77577917ccaf840e181f`, on
`feature/coolify-production`. This branch depends on the unmerged fixes in PR #4.
No deployment, server access, database mutation, image publication or data deletion
was performed. These checks do not certify production readiness.

| Check | Actual result |
| --- | --- |
| Production Compose configuration | Pass, normal and maintenance-profile configurations; no services started |
| Deployment tests | 18 passed / 1 suite |
| Inbox + Reporting + safety integration tests | 112 passed / 13 suites |
| Deployment ESLint | 0 errors, 0 warnings |
| Production shell scripts | All five pass Git Bash `bash -n` |
| Prisma 6.5 schema validation | Pass using a synthetic connection URL; no database connection required |
| Frontend production build and TypeScript | Pass, including the Reports route |
| Backend and orchestrator TypeScript | Both pass, standalone `tsc --noEmit --incremental false` |
| Complete production build | Pass, `pnpm run build`, exit 0: frontend, backend and orchestrator |
| Pinned image registry manifests | Resolved successfully; this is not an image build or vulnerability scan |
| Docker production image build | Blocked: Docker Desktop Linux engine named pipe is unavailable |

The test commands use the existing local dependency installation, Node 22.23.4,
and pnpm 10.6.1. Combined Jest ran with roots restricted to tests/inbox,
tests/reporting and tests/integration to avoid crawling generated Next artifacts;
all 13 original suites and 112 cases ran. Deployment tests use separate roots.
Database guard tests use ephemeral PGlite, not PostgreSQL service containers.
Temporal RPC tests use mocks, not a running Temporal server.

The first Next compilation stalled with its existing local cache. That process
was stopped and the cache directory moved aside intact inside `.next`; the retry
compiled successfully. No application data or cache files were deleted.

The inherited repository-wide ESLint backlog (128 errors / 1,102 warnings from
the safety audit) was not rerun or fixed as part of deployment configuration.
See the safety-audit documents for its reviewed scope. Deployment lint does not
imply that repository-wide lint is clean.

## Required acceptance work on an isolated Docker host

- Build every production image, including the Linux native-module probes.
- Verify empty-only initialization, subsequent read-only schema checks, failed
  gates, restart behavior, volume ownership, backup/restore and migration drift.
- Verify PostgreSQL/Redis authentication, Temporal schema/namespace readiness and
  actual worker pollers. Review the pinned Temporal 1.28.1 baseline's support and
  security status before release; do not treat its pin as a current-version claim.
- Verify Coolify routing, HTTPS cookies, uploads/WebSockets, registration controls
  and cross-organization access. Test Chromium PDF sandbox operation on that host.
- Scan the built image and benchmark resource limits. The runtime intentionally
  retains hoisted workspace dependencies for compatibility.
- Validate real provider permissions and responses. Meta comments/DMs, App Review
  and reporting metrics remain unvalidated. Inbox/Reporting collection stays off
  by default; Meta Ads/Google Ads remain extensible models, not live collectors.

Use [the production runbook](PRODUCTION_COOLIFY.md) for exact Coolify settings,
initialization consent flags, manual migration paths and operator acceptance steps.
