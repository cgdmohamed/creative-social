# Creative Social: Sentry Cloud setup

This deployment already includes Sentry SDKs for the Next.js frontend and NestJS backend/workers. The integration is **optional**, disabled with an empty DSN. This release connects the public DSN to the production frontend allowlist and image builder, and annotates errors with the Git commit revision.

## Minimal setup (operator; no API token in source)

1. In Sentry Cloud, create a **JavaScript / Next.js** project for Creative Social. Copy the **public DSN** from project settings > Client Keys (DSN). It is an ingestion identifier, **not** an API authentication token.
2. In this repository's GitHub **Settings > Secrets and variables > Actions > Variables**, add `CREATIVE_SOCIAL_SENTRY_DSN` with that public DSN. The production image workflow consumes this as a **public build argument**; do not put a private Sentry auth token in it.
3. In Coolify's Creative Social Environment Variables, add `NEXT_PUBLIC_SENTRY_DSN` with the **same DSN**. Keep build argument injection of project-wide runtime secrets disabled. Coolify's frontend start allowlist now deliberately permits only this Sentry public DSN, never private JWT, database or OAuth credentials.
4. **After both settings are in place**, build a fresh, reviewed commit-tagged GHCR image. Because Next.js embeds `NEXT_PUBLIC_` variables at image build time, merely changing Coolify runtime configuration cannot enable browser reporting on an already-built image.
5. Apply only required additive database migrations after verified backup, and deploy the exact image SHA with matching `CREATIVE_REVISION`. Do not reapply 007 or reset tables.
6. Test one **controlled non-sensitive** failure in staging and confirm both browser and backend event reception in Sentry Issues, including service tags/release. Ensure event payloads do not include credentials, tokens, customer posts, private content, or full request bodies. Delete the test event if needed.
7. In Sentry organization **Settings > Integrations > GitHub**, install the official [Sentry GitHub App](https://github.com/apps/sentry) with access to **only** `cgdmohamed/creative-social`; authorize using your GitHub account. This authorization is performed in the Sentry/GitHub UI, not through a GitHub Actions workflow. Link the repository in Sentry. This enables source and commit references and issue/PR links, subject to Sentry plan features.
8. Set Sentry issue alerts for *new issues* and *regressions* to email and verify delivery. Manage monthly quotas, sampling and retention in the Sentry project. No separate observability VPS is needed.

## Security and limitations

- The current app has the `@sentry/nextjs` dependency declared in `package.json`. Updating it and `pnpm-lock.yaml` to a patched version is a **separate security-release gate**: GitHub Dependabot reported a critical vulnerability in an affected release. Do not confuse a functioning DSN with a remediated dependency. Prefer a lockfile-consistent, tested update of all Sentry SDK packages together.
- A public DSN may be exposed to browsers, but `SENTRY_AUTH_TOKEN`, organization auth tokens and other credentials must not go in the repo, browser code, image build arguments or frontend container. This setup intentionally does **not** include sourcemap upload authentication. Release/source context still depends on the available Sentry integration and sourcemaps.
- Avoid setting `sendDefaultPii: true`, adding unrestricted request body logging or high replay sampling on production without a separate privacy review. Existing project SDK behavior requires independent validation under real data.
- GitHub installation and Sentry organization/project creation need the owner's explicit web authorization; repository source changes alone cannot complete them.
