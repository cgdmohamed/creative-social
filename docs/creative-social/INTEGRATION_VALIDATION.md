# develop integration validation — 2026-11-02

Local host: Windows, Node **22.23.4**, pnpm **10.6.1**, Prisma **6.5.0**.
No deployment, production database access or live Meta/Ads API validation occurred.

## Verified

| Check | Result |
| --- | --- |
| `pnpm run test:combined` | **PASS — 77 tests / 9 suites** (Inbox/provider contracts, Reporting HTTP/UI/metrics/collector/workers, database coexistence). |
| `pnpm run lint:integration` | **PASS — 0 errors, 1 existing remote-avatar img warning.** |
| `tsc --noEmit -p apps/backend/tsconfig.json` | **PASS** after adding explicit shared-code type annotations. |
| `tsc --noEmit -p apps/orchestrator/tsconfig.json` | **PASS**. |
| `tsc --noEmit -p apps/frontend/tsconfig.json` | **PASS**. |
| `pnpm run build` | **PASS — Next production, backend Nest and orchestrator Nest builds.** |
| Prisma validate / generate | **PASS** for the combined schema and generated client. |
| `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` | **PASS** using pinned pnpm 10.6.1; confirms manifest/lock agreement, not a fresh Linux install. |
| Additive SQL against main's full schema | **PASS — PGlite** baseline + 001 + 002 + 003 equals merged Prisma-generated catalog, including columns/defaults, enum values, indexes and constraints. |
| Cross-feature persistence | **PASS** real Inbox read-marker and Reporting snapshot repository methods through SQL adapters; client attribution survives channel reassignment, foreign organizations cannot insert Inbox/Reporting rows, deletion cascades across both features. |
| Shared API routing | **PASS** both controllers in one Nest HTTP fixture; disabled Inbox sync returns 503 while stored Inbox and client report comparison remain available. Eight live Inbox routes tested disabled. |
| PDF smoke | **PASS** real local Chrome, synthetic observations, two A4 pages, inspected with Poppler. Arabic text, wrapping, tables and pagination visually checked. Does not verify Linux Chromium sandbox. |
| `docker compose ... config --quiet` | **PASS** with synthetic staging.env.example; configuration validation only, no containers started. |
| `git diff --check` | **PASS**. |

The circular shared ESLint configuration failure is fixed by ESLint 9-compatible
plugins and Next 16's native flat configuration; frontend reuses the root config.
A single ScheduleModule root now registers Inbox and Reporting jobs. Inbox live
API access and collection are opt-in, matching Reporting's default-disabled collection.
Source history/AGPL notices and previously published SQL upgrades are preserved.

Initial strict API/worker checks exposed implicit-any declarations in legacy
wallet/media/email/short-linking and LangGraph default state functions. Explicit
parameter, query and return types resolve them without changing runtime behavior.

## Unresolved / not verified

- **Repository-wide lint remains failing:** `pnpm run lint` now analyzes files
  successfully but reports **134 errors and 1,109 warnings**, errors in 75 source
  files outside the integration lint scope. Breakdown: 56 set-state-in-effect,
  30 refs, 17 immutability, 12 no-this-alias, 6 use-memo, 5 no-require-imports,
  and 2 each static-components, preserve-manual-memoization,
  no-wrapper-object-types and rules-of-hooks. These are legacy source violations
  exposed by the current Next rules, not the former config-loading exception.
  CI deliberately gates integration files, not a falsely clean whole-repo lint.
- **Docker runtime blocker:** Docker CLI exists but the Docker Desktop Linux
  daemon pipe is unavailable. No candidate Docker image has been built or booted;
  no Coolify resource was inspected or created. Private DNS/networking, Compose
  image build, non-root Chromium sandbox and health routing remain unverified.
- **Staging PostgreSQL migration rehearsal pending:** PGlite is PostgreSQL WASM
  behind transport fixtures. Real Prisma connectivity, existing staging data,
  backup/restore and zero-drift verification need a separate approved environment.
- **Isolated Temporal required:** provision the namespace, search attributes and
  connectivity; real worker polling/publishing was not exercised. The candidate
  intentionally requires its endpoint instead of silently using production.
- **No live Meta validation:** App Review/Advanced Access, OAuth/reconnect scopes,
  Facebook/Instagram account eligibility, comments, moderation, DM window/identity,
  API quota and reporting responses remain untested with real accounts.
- **No live Ads integration:** Meta Ads and Google Ads remain storage/adapter
  contracts, without collectors/OAuth/spend endpoints. Report counters can include
  promoted activity and disclose PLATFORM_TOTAL rather than guaranteed organic-only reach.
- **Browser end-to-end validation pending:** fixtures inject organization context
  and mock provider/auth boundaries; they do not prove real login/cookie behavior,
  role permissions, two-client browser navigation or proxy/TLS behavior.
- **Infrastructure image digests and resource sizing pending:** staging definitions
  are reviewable candidates using version tags. Pin reviewed digests and verify
  PDF memory/concurrency on the intended host before launch.
- Existing feature limits remain: bounded recent Inbox synchronization, no full
  historical/webhook backfill or retention jobs; bounded reports and collection
  batches; only observations actually collected contribute to history.
- GitHub-hosted CI results are separate from these verified local runs. Review its
  checks on the integration PR before accepting the branch.

See [STAGING.md](STAGING.md) for environment variables, migration order and the
approval-gated staging runbook. Both collection flags default false. PR #1 and
PR #2 remain open against main; this integration does not merge either into main.
