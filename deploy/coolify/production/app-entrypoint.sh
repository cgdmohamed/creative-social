#!/bin/sh
set -eu
cd /app
case "${1:-backend}" in
  backend)
    node deploy/coolify/production/validate-env.cjs backend
    exec node --experimental-require-module apps/backend/dist/apps/backend/src/main.js ;;
  frontend)
    node deploy/coolify/production/validate-env.cjs frontend
    cd apps/frontend
    exec node /app/node_modules/next/dist/bin/next start -p 4200 -H 0.0.0.0 ;;
  orchestrator)
    node deploy/coolify/production/validate-env.cjs orchestrator
    exec node --experimental-require-module apps/orchestrator/dist/apps/orchestrator/src/main.js ;;
  schema-check) exec node deploy/coolify/production/database.cjs check ;;
  initialize-empty) exec node deploy/coolify/production/database.cjs initialize-empty ;;
  namespace-check) exec node deploy/coolify/production/namespace.cjs ;;
  *) echo 'Unknown application role' >&2; exit 1 ;;
esac
