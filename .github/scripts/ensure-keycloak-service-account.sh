#!/usr/bin/env bash
#
# Ensure a confidential service-account client exists in the target Keycloak
# realm for the FSP backend's callouts to the nr-user-lookup-api, with the
# user-lookup client scopes assigned so its client_credentials token carries
# the SCOPE_* authorities that API enforces.
#
# Idempotent:
#   - creates the client only if it's missing (existing client left untouched);
#   - assigns each required scope as a DEFAULT client scope (PUT is a no-op when
#     already assigned) so the service-account token always includes them.
#
# The scopes themselves are NOT created here — nr-user-lookup-api owns them
# (see its .github/scripts/ensure-keycloak-scopes.sh). This script only wires
# our client to the scopes that already exist in the shared realm; it errors if
# a required scope is absent.
#
# Authenticates with a confidential admin service-account client
# (client_credentials) that has the realm-management `manage-clients` role.
# Realm + endpoints are derived from KEYCLOAK_ISSUER_URI (single source of
# truth; works with or without an `/auth` base path).
#
# Required environment:
#   KEYCLOAK_ISSUER_URI   e.g. https://test.loginproxy.gov.bc.ca/auth/realms/my-realm
#   KC_SA_CLIENT_ID       admin service-account client id (manage-clients)
#   KC_SA_CLIENT_SECRET   admin service-account client secret
# Optional:
#   FSP_CLIENT_ID         clientId of the service account to ensure
#                         (default: nr-fsp-backend)
#
# Emits the resulting client id + secret as masked GitHub Actions step outputs
# (`client_id`, `client_secret`) so a deploy step can feed them to the backend.
#
# Keep SCOPES in sync with the scopes the FSP backend requests from
# nr-user-lookup-api (ApiScopes in that repo: user-lookup:idir:search,
# user-lookup:idir:read, user-lookup:business-bceid:read).
set -euo pipefail

: "${KEYCLOAK_ISSUER_URI:?KEYCLOAK_ISSUER_URI is required}"
: "${KC_SA_CLIENT_ID:?KC_SA_CLIENT_ID is required}"
: "${KC_SA_CLIENT_SECRET:?KC_SA_CLIENT_SECRET is required}"

FSP_CLIENT_ID="${FSP_CLIENT_ID:-nr-fsp-backend}"

# Scopes the FSP backend needs from nr-user-lookup-api. Trim this list if the
# backend only calls a subset of the lookup endpoints.
SCOPES=(
  "user-lookup:idir:search"
  "user-lookup:idir:read"
  "user-lookup:business-bceid:read"
)

issuer="${KEYCLOAK_ISSUER_URI%/}"
realm="${issuer##*/realms/}"
base="${issuer%/realms/*}"
token_url="${issuer}/protocol/openid-connect/token"
clients_url="${base}/admin/realms/${realm}/clients"
scopes_url="${base}/admin/realms/${realm}/client-scopes"

echo "Keycloak realm: ${realm}"
echo "Ensuring service-account client: ${FSP_CLIENT_ID}"

# --- obtain an admin token via client_credentials ---------------------------
token="$(curl -sS -X POST "${token_url}" \
  -d grant_type=client_credentials \
  -d client_id="${KC_SA_CLIENT_ID}" \
  --data-urlencode "client_secret=${KC_SA_CLIENT_SECRET}" \
  | jq -r '.access_token // empty')"

if [ -z "${token}" ]; then
  echo "::error::Could not obtain a Keycloak admin token. Check the admin service-account client id/secret and that it has the realm-management 'manage-clients' role."
  exit 1
fi

auth=(-H "Authorization: Bearer ${token}")

# --- ensure the client exists ----------------------------------------------
uuid="$(curl -sS "${auth[@]}" "${clients_url}?clientId=${FSP_CLIENT_ID}" \
  | jq -r '.[0].id // empty')"

if [ -n "${uuid}" ]; then
  echo "✓ client exists: ${FSP_CLIENT_ID} (${uuid})"
else
  echo "+ creating client: ${FSP_CLIENT_ID}"
  body="$(jq -n --arg id "${FSP_CLIENT_ID}" '{
    clientId: $id,
    name: "NR FSP backend (user-lookup callouts)",
    description: "Service account for the FSP backend → nr-user-lookup-api. Managed by nr-fsp-new CI.",
    protocol: "openid-connect",
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    authorizationServicesEnabled: false,
    frontchannelLogout: false
  }')"

  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${clients_url}" \
    "${auth[@]}" -H 'Content-Type: application/json' -d "${body}")"
  if [ "${code}" != "201" ]; then
    echo "::error::Failed to create client '${FSP_CLIENT_ID}' (HTTP ${code})."
    exit 1
  fi

  uuid="$(curl -sS "${auth[@]}" "${clients_url}?clientId=${FSP_CLIENT_ID}" \
    | jq -r '.[0].id // empty')"
  if [ -z "${uuid}" ]; then
    echo "::error::Created client '${FSP_CLIENT_ID}' but could not resolve its id."
    exit 1
  fi
  echo "  created (${uuid})"
fi

# --- assign the required scopes as DEFAULT client scopes --------------------
# Default (not optional) so the client_credentials token always carries them —
# the service account never sends an explicit `scope` request.
all_scopes="$(curl -sS "${auth[@]}" "${scopes_url}")"

for scope in "${SCOPES[@]}"; do
  scope_id="$(jq -r --arg n "${scope}" '.[] | select(.name == $n) | .id' <<< "${all_scopes}")"
  if [ -z "${scope_id}" ]; then
    echo "::error::Client scope '${scope}' does not exist in realm '${realm}'. It must be created first (nr-user-lookup-api owns scope creation)."
    exit 1
  fi

  code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
    "${clients_url}/${uuid}/default-client-scopes/${scope_id}" "${auth[@]}")"
  if [ "${code}" != "204" ]; then
    echo "::error::Failed to assign scope '${scope}' to '${FSP_CLIENT_ID}' (HTTP ${code})."
    exit 1
  fi
  echo "✓ scope assigned: ${scope}"
done

# --- read the client secret + emit masked outputs --------------------------
secret="$(curl -sS "${auth[@]}" "${clients_url}/${uuid}/client-secret" \
  | jq -r '.value // empty')"
if [ -z "${secret}" ]; then
  echo "::error::Could not read the client secret for '${FSP_CLIENT_ID}'."
  exit 1
fi

# Mask so it can't leak into logs even if a later step echoes an output.
echo "::add-mask::${secret}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "client_id=${FSP_CLIENT_ID}"
    echo "client_secret=${secret}"
  } >> "${GITHUB_OUTPUT}"
fi

echo "Done. '${FSP_CLIENT_ID}' ready with ${#SCOPES[@]} scope(s); client_id/client_secret exposed as step outputs."
