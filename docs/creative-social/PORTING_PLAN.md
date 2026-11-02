# Creative Social — upstream feature porting plan

Base: `gitroomhq/postiz-app`; integration branch: `feature/unified-inbox` (created from `main`).

## Eryk inbox series (oldest to newest, from `buzzin/v2.10.1-comments`)

- `afcf644832915297d5ba38de34aac88f5a98e06f` provider comments/replies contract
- `abbce089c809d5397e60afbd7f6235a1fc4e74cb` inbox controller, comments and private messaging
- `75f46c8583f5` per-channel timeouts
- `0897d4f5c807` split comments and messages, moderation
- `00b72cabafaa` Redis caching
- `0eee983b8159` error handling
- `5e01d4501488` three-column UI and read tracking
- `2eb0f244cf4c` interface styling
- `98f0fc08671d` database-backed inbox and sync job
- `087039f52636` platform errors
- `de7a85bd9a0d` own replies in comment threads
- `b95ea8b04472` channel grouping
- `4b5ce3d4169e` threaded comment replies

## Analytics candidates (do not apply until dependencies checked)

`c831ec9bb120`, `a9f8b847caa3`, `4bf23f8a354f`, `1736550c3f34`.

## Porting rules

1. Compare upstream release compatibility and dependency changes before cherry-picking.
2. Apply commits on a feature branch with `git cherry-pick -x`, preserving attribution.
3. Resolve Prisma schema/migrations, providers, OAuth scopes, cron job and UI differences.
4. Run build, lint, tests and sandbox channel authorization/response tests before merging.
5. Do not merge to main or deploy until verified.
6. Postmill report implementation is substantially embedded in its initial snapshot; selective porting is more appropriate than a blind cherry-pick.

Status: **Inbox port implemented on `feature/unified-inbox`**. All thirteen inbox
commits have been applied with source attribution; incompatible publishing/schema/
cron changes were adapted and unrelated analytics dependencies were excluded.
See [INBOX.md](INBOX.md) for compatibility details, API permissions, database upgrade,
limits and validation requirements. Analytics/reporting inspection and porting
remain Task 2. No production deployment has been performed.
