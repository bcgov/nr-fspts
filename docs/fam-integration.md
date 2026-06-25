# FAM Identity-Lookup Integration

FSPTS resolves IDIR user details (display name, email) from **FAM** (the BC Gov
Forest Access Management identity service) via its identity-lookup API:

```
GET {base}/external/v1/users/identity/idir/search?userId=...&username=...
```

The base URL is `ca.bc.gov.nrs.identity-lookup.base-url`. The app calls this
endpoint from **two places, with two different auth strategies**, because they
run in different contexts.

## Path 1 — in-request (user picker)

`service/v1/UserDirectoryService` serves the in-app IDIR **user search** (the
District Notification "Add user" modal → `GET /api/v1/fsp/users/search`, and
`findByUserId` lookups).

- Runs **inside an HTTP request**, so the caller's own Cognito JWT is on the
  thread.
- `extractBearerToken()` pulls that token and forwards it to FAM as the
  `Authorization: Bearer` header — the user searches FAM **as themselves**.
- Built on Spring's `RestClient`.

## Path 2 — scheduled (designate digest)

`notification/FamDesignateEmailResolver` resolves a district designate's IDIR
username → email for the [digest batch](notifications.md#2-district-designate-digest-scheduled-batch).

- Runs on a **scheduler thread** where there is **no security context** — there
  is no caller JWT to forward.
- So it authenticates with its **own service account** via OAuth2
  **`grant_type=client_credentials`** (`ClientCredentialsTokenSource`),
  caching the access token until ~60s before expiry.
- Config (all optional; the resolver logs its active mode at startup):
  `FSP_FAM_TOKEN_URL`, `FSP_FAM_CLIENT_ID`, `FSP_FAM_CLIENT_SECRET`,
  `FSP_FAM_SCOPE`. With none set, it calls FAM unauthenticated (and logs the
  401 once per designate) — a fallback for deployments where the IDIR search is
  open inside the BC Gov network.

> History: a static `FSP_FAM_BEARER_TOKEN` override used to exist; it was
> removed in favour of "we either have a working service account or we don't".
> The OAuth2 client-credentials path is the only authenticated mode now.

## The `userId` vs `username` quirk

FAM's identity-lookup routes by token type: with a **user** token (Path 1) it
keys on `userId`; the **service-to-service** handler (Path 2) expects
`username`. To be robust regardless of which handler the token routes through,
lookups send **both** query params with the same value. Designate IDIRs are
stored AD-prefixed (`IDIR\NAME`); the bare username is what FAM keys on, so the
prefix is stripped before the call.

## Why two paths

| | In-request (`UserDirectoryService`) | Scheduled (`FamDesignateEmailResolver`) |
|---|---|---|
| Context | HTTP request | scheduler thread |
| Auth | caller's Cognito JWT | OAuth2 client-credentials service account |
| Trigger | user clicks "search" | cron digest |
| Client | `RestClient` | `RestClient` + token cache |

Same upstream endpoint, different identity — a request-scoped lookup acts as the
signed-in user; a background job has no user, so it needs its own credentials.
