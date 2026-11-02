# Final local validation — 2026-11-02

Node 22.23.4, pnpm 10.6.1, TypeScript 5.5.4, Prisma 6.5.0, ESLint 9.39.5.
All results below are local. No production connection or deployment occurred.

| Command / check | Actual result |
| --- | --- |
| `pnpm run test:combined` | **PASS: 112 tests / 13 suites.** All original 77 tests plus 35 regression cases retained. |
| `pnpm run lint:integration` | **PASS: 0 errors / 1 existing image warning.** |
| `pnpm run lint:safety` | **PASS: 0 errors / 10 recorded P2 warnings.** Covers changed critical source and tests, including OAuth repository/service. |
| Repository-wide `eslint . --format json` | **FAIL as documented: 128 errors / 1,102 warnings in final snapshot**, down from measured 134 / 1,109. No rule/ignore relaxation or new suppression. |
| `tsc --noEmit -p apps/backend/tsconfig.json` | **PASS** after final functional changes, including atomic OAuth redemption. |
| `tsc --noEmit -p apps/orchestrator/tsconfig.json` | **PASS**. |
| `tsc --noEmit -p apps/frontend/tsconfig.json` | **PASS**. |
| `pnpm run build` | **PASS: full production build of frontend, backend and orchestrator** after final functional changes. |
| Prisma 6.5 schema validation | **PASS**; schema/migration files unchanged by audit patch. |
| Combined baseline/migration test | **PASS**: pinned main full schema + 001/002/003 equals merged catalog in ephemeral PGlite. |
| OAuth replay/expiry/replacement/revocation | **PASS**: eight repository/SQL-adapter tests, both cloud and self-hosted grants; exactly one concurrent redemption succeeds. |
| Frozen lockfile-only validation | **PASS** with pinned pnpm 10.6.1; no dependency changes. |
| Node `require("file-type")` interop | **PASS**: buffer/stream detection exports load under pinned Node; not a full upload test. |
| `docker compose ... config --quiet` | **PASS** with synthetic staging.env.example; no resources created. |
| Docker Desktop Linux daemon | **BLOCKED**: local daemon pipe is unavailable. No Linux image build/boot/runtime readiness claim. |
| `git diff --check` | **PASS**. |

Full inventory includes each original error/warning with rule, file, line, affected
functionality, risk, upstream provenance, review/remediation and after status.
Classification found six P1 lint errors plus behavioral findings described in
[the audit](../PRE_STAGING_AUDIT.md). All nine confirmed P1 behavioral findings
are fixed and covered; no P0 was confirmed. Remaining P2 findings are not asserted
harmless or validated simply because tests pass.

Tests exercise actual controllers/services/repositories at documented fixture
boundaries. Auth database/signature boundaries, provider APIs and UI configuration
are mocked. SQL adapters execute PostgreSQL semantics through PGlite; they do not
replace live Prisma/PostgreSQL, real Redis/Lua/expiry/failover, TLS/browser login,
Meta OAuth/App Review/DM/analytics, Temporal worker or Coolify-host validation.
No live API results are claimed. Both collection flags remain opt-in/default false.

No new environment variable or database migration is introduced. Existing manual
migration sequence and staging restrictions remain in STAGING.md. Main and
production infrastructure were not touched. GitHub Actions results must be
reviewed separately from the verified local checks above.
