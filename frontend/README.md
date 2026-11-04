# FSPTS Frontend (SPA)

The Forest Stewardship Plan Tracking System single-page app.

- **React 19** + **TypeScript**, built with **Vite 6**
- **BC Gov Carbon Design System** (`@carbon/react`) — the BCGov theme is
  inlined under `src/styles/bcgov/`
- **oidc-client-ts** for BC Gov SSO (Keycloak) auth (IDIR / BCeID Business)
- `react-router-dom` for routing

It talks to the [backend API](../backend/README.md) with a Keycloak access token;
see [../docs/architecture.md](../docs/architecture.md) for the big picture.

## Local development

```bash
npm install
npm run dev          # Vite dev server → http://localhost:3000
```

Requires `frontend/.env` (copy `.env.example` and fill in the Keycloak client
id and API base). Vite proxies `/api/*` to the backend at `:8080`
(see `vite.config.ts`). Or run the whole stack from the repo root with
`docker compose up`.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` / `start` | Vite dev server (HMR) |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` (the real type gate — CI runs this) |
| `npm run e2e` | Playwright end-to-end suite (see [e2e/README.md](e2e/README.md)) |
| `npm run lint` | placeholder (no ESLint config yet) |
| `npm test` | placeholder (no unit tests yet — coverage is e2e) |

> There is no unit-test or lint setup yet; `typecheck` + the Playwright e2e
> suite are the current quality gates.

## Structure

```
src/
├── main.tsx, App.tsx       entry + top-level router
├── pages/                  one folder/file per screen (Search, Inbox, Reports,
│                           DistrictNotification, XmlSubmission, FspInformation, …)
├── components/             shared UI (modals, layout, pickers)
├── routes/                 routePaths.ts (nav model) + access.ts (role capabilities)
├── services/               typed fetch wrappers per domain; apiFetch.ts (auth + errors)
├── context/                auth, active org, theme, notifications
├── styles/                 Carbon + inlined BCGov theme
├── lib/, utils/, config/   helpers, env, constants
└── env.ts                  typed environment access (VITE_* vars)
```

## Routing & access

- `routes/routePaths.ts` is the **nav model** — entries carry optional `roles`
  gates (e.g. Data Submission → Administrator/Submitter).
- `routes/access.ts` holds the **capability predicates** (`canEditFspContent`,
  `canActionWorkflow`, `isAdministrator`, `canEditFsp`, `canSeeWorkflowTab`,
  `isPathAllowedForUser`) that mirror the backend authorization matrix.

Whatever the UI hides, the backend independently enforces — see
[../docs/roles-and-security.md](../docs/roles-and-security.md).

## Auth

`services/keycloak.ts` holds the oidc-client-ts `UserManager` (Authorization
Code + PKCE, tokens in `sessionStorage`, `kc_idp_hint` of `azureidir` or
`bceidbusiness`). Keycloak redirects back to `/authCallback`
(`pages/AuthCallback.tsx`), which completes the code exchange. `context/auth`
publishes the session; `services/apiFetch.ts` renews the access token when it
is within a minute of expiry, attaches it as a `Bearer` header on every API
call, and normalizes error bodies (RFC 7807 `ProblemDetail` →
`detail`/`message`/`title`) into a clean message for toasts.

`components/SessionTimeout` signs the user out after 25 minutes without
activity, warning at 20. That sits under the realm's 30-minute refresh-token
lifetime, so "Stay logged in" always has a live refresh token to use. Same
settings as nr-rept.

## Deployment

Built to a static bundle and served by **Caddy**, which reverse-proxies
`/api/*` to the backend Service on OpenShift (CI/CD in
[`.github/workflows/`](../.github/workflows/)). PR previews use a fixed pool of
hostnames (see the CI workflows); each needs `<host>/authCallback` and `<host>`
registered as redirect URIs on the CSS integration.
