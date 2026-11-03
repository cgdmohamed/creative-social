#!/bin/sh
set -eu
cd /app
case "${1:-backend}" in
  backend)
    node deploy/coolify/production/validate-env.cjs backend
    exec node --experimental-require-module apps/backend/dist/apps/backend/src/main.js ;;
  frontend)
    # Coolify may inject project-wide secrets into this container regardless of
    # Compose service overrides. Start the entire frontend runtime with a strict
    # allowlist so neither the validator nor Next.js inherits backend secrets.
    exec env -i \
      PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}" \
      HOME="${HOME:-/app}" \
      NODE_ENV="${NODE_ENV:-production}" \
      PUBLIC_URL="${PUBLIC_URL:-}" \
      CREATIVE_REVISION="${CREATIVE_REVISION:-}" \
      MAIN_URL="${MAIN_URL:-}" \
      FRONTEND_URL="${FRONTEND_URL:-}" \
      NEXT_PUBLIC_BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL:-}" \
      BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-}" \
      STORAGE_PROVIDER="${STORAGE_PROVIDER:-local}" \
      UPLOAD_DIRECTORY="${UPLOAD_DIRECTORY:-/app/uploads}" \
      NEXT_PUBLIC_UPLOAD_DIRECTORY="${NEXT_PUBLIC_UPLOAD_DIRECTORY:-/uploads}" \
      NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY="${NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY:-/uploads}" \
      IS_GENERAL="${IS_GENERAL:-true}" \
      DISABLE_REGISTRATION="${DISABLE_REGISTRATION:-true}" \
      NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}" \
      /bin/sh -ec '
        cd /app
        node deploy/coolify/production/validate-env.cjs frontend
        cd apps/frontend
        exec node /app/node_modules/next/dist/bin/next start -p 4200 -H 0.0.0.0
      ' ;;
  orchestrator)
    node deploy/coolify/production/validate-env.cjs orchestrator
    exec node --experimental-require-module apps/orchestrator/dist/apps/orchestrator/src/main.js ;;
  schema-check) exec node deploy/coolify/production/database.cjs check ;;
  initialize-empty) exec node deploy/coolify/production/database.cjs initialize-empty ;;
  namespace-check) exec node deploy/coolify/production/namespace.cjs ;;
  *) echo 'Unknown application role' >&2; exit 1 ;;
esac
