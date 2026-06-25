# nr-fsp — Forest Stewardship Plan Tracking System (FSPTS)

A web application for submitting, reviewing, and tracking **Forest Stewardship
Plans (FSPs)** under BC's *Forest and Range Practices Act*. It replaces the
legacy FSP Tracking System: licensees submit plans (XML or GeoJSON), ministry
staff review and make decisions, and the system manages the full plan
lifecycle — amendments, replacements, extensions, and stocking standards.

This is a modernized front end over the **existing legacy Oracle database**
(`THE` schema). The backend does not own its data model; it calls the same
PL/SQL packages (`FSP_300_INFORMATION`, `FSP_700_WORKFLOW`, `FSP_TOMBSTONE`,
…) the legacy app used. Understanding that constraint is the key to
understanding this codebase — see [docs/database.md](docs/database.md).

## Architecture at a glance

```
┌─────────────────┐   HTTPS / JWT    ┌──────────────────┐   stored procs   ┌───────────────┐
│  React SPA      │ ───────────────▶ │  Spring Boot API │ ───────────────▶ │ Oracle (THE)  │
│  Vite · Carbon  │  Cognito access  │  resource server │   JDBC / cursors │ legacy PL/SQL │
│  (frontend/)    │  token (IDIR/    │  (backend/)      │                  │  = nr-mof-db  │
└─────────────────┘   BCeID)         └──────────────────┘                  └───────────────┘
```

- **Frontend** — React 19 + TypeScript + Vite, BC Gov Carbon Design System,
  AWS Amplify for Cognito (IDIR / BCeID Business) auth. See
  [frontend/README.md](frontend/README.md).
- **Backend** — Java 21 + Spring Boot 3.5, OAuth2 resource server (validates
  Cognito JWTs), thin services over stored-procedure DAOs. See
  [backend/README.md](backend/README.md).
- **Database** — the shared BC Gov Oracle (`THE` schema). The PL/SQL lives in
  a separate repo, **`nr-mof-db`**; this app only calls it.

## Quick start

Prerequisites: BC Gov VPN (for Oracle reachability), Docker, and the local
config files described in [`compose.yml`](compose.yml) (a gitignored
`backend/src/main/resources/application-local.yml`, an Oracle truststore, and
`frontend/.env`).

```bash
docker compose up          # backend :8080 + frontend :3000
```

Or run each side natively — see the backend and frontend READMEs. The SPA is
at <http://localhost:3000>; the API serves <http://localhost:8080> with
OpenAPI/Swagger at `/swagger-ui`.

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/architecture.md](docs/architecture.md) | Layers, request flow, the stored-procedure DAO pattern, auth flow |
| [docs/roles-and-security.md](docs/roles-and-security.md) | The six FSPTS roles, the capability matrix, and how authorization is enforced front-to-back |
| [docs/database.md](docs/database.md) | How the API talks to the legacy Oracle packages, the ownership fence, and the FSP status state machine |
| [docs/submissions.md](docs/submissions.md) | The XML / GeoJSON submission pipeline (validate → preview → persist) |
| [docs/submission-geojson-spec.md](docs/submission-geojson-spec.md) | Client-facing GeoJSON upload format specification |
| [frontend/e2e/README.md](frontend/e2e/README.md) | The Playwright end-to-end suite |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching, PRs, local setup, testing |

## Repository layout

```
backend/    Spring Boot API (Java 21)
frontend/   React SPA (Vite + TypeScript)
docs/       Architecture, security, database, submission docs
compose.yml Local-dev Docker Compose (backend + frontend; no DB — uses shared Oracle)
.github/    CI/CD workflows (build, deploy, e2e), issue/PR templates
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
