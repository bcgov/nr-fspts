#!/bin/sh
# Generate /srv/config.js from VITE_* env vars at container start.
# index.html loads /config.js before the app bundle; src/env.ts then merges
# window.config over import.meta.env, so these runtime values win. This lets a
# single image serve DEV/TEST/PROD with env-specific values supplied by the
# OpenShift Deployment.
set -eu

# /tmp/coraza is created in the Dockerfile, but in Kubernetes it gets shadowed
# by the emptyDir mount on /tmp (needed for readOnlyRootFilesystem=true).
# Recreate it here so Coraza WAF has its scratch dir.
mkdir -p /tmp/coraza

CONFIG_FILE=/srv/config.js

# JSON-escape for embedding in a double-quoted JS string. Values we inject are
# URLs / IDs / short identifiers, so handling \ and " is sufficient.
escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$CONFIG_FILE" <<EOF
// Generated at container start by docker-entrypoint.sh from VITE_* env vars.
window.config = {
  VITE_USER_POOLS_ID: "$(escape "${VITE_USER_POOLS_ID:-}")",
  VITE_USER_POOLS_WEB_CLIENT_ID: "$(escape "${VITE_USER_POOLS_WEB_CLIENT_ID:-}")",
  VITE_REDIRECT_SIGN_OUT: "$(escape "${VITE_REDIRECT_SIGN_OUT:-}")",
  VITE_BACKEND_URL: "$(escape "${VITE_BACKEND_URL:-}")",
  VITE_APP_NAME: "$(escape "${VITE_APP_NAME:-FSP}")",
  VITE_ZONE: "$(escape "${VITE_ZONE:-dev}")"
};
EOF

exec /usr/bin/caddy "$@"
