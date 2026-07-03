# How to contribute

Government employees, the public, and members of the private sector are
encouraged to contribute by **creating a branch and submitting a pull request**.
Outside forks come with permission complications but can still be accepted.

(New to GitHub? Start with a [basic tutorial](https://help.github.com/articles/set-up-git)
and a guide to [pull requests](https://help.github.com/articles/using-pull-requests/).)

## Getting set up

Read the [root README](./README.md) first, then the module READMEs:

- **Backend** — [backend/README.md](./backend/README.md). Needs BC Gov VPN, a
  gitignored `application-local.properties`, and an Oracle truststore. There is no
  local database; the API talks to the shared Oracle.
- **Frontend** — [frontend/README.md](./frontend/README.md). Needs a
  `frontend/.env` with Cognito config.
- Or run both with `docker compose up` from the repo root.

Before changing anything non-trivial, skim the docs for the area you're touching:

| If you're working on… | Read |
|---|---|
| API endpoints, services, or DAOs | [docs/architecture.md](./docs/architecture.md), [docs/database.md](./docs/database.md) |
| Anything role- or permission-related | [docs/roles-and-security.md](./docs/roles-and-security.md) |
| Submission parsing/validation | [docs/submissions.md](./docs/submissions.md) |

## Workflow

- Branch off `main`; keep PRs focused.
- The backend calls **legacy Oracle PL/SQL** (`nr-mof-db`). It owns the schema,
  business rules, and status transitions — push logic there, keep services thin,
  and don't add an ORM or migrations to this repo.
- Authorization is enforced **server-side**. If you add a write endpoint, gate
  it with the right `FspAuthorities` capability and (for FSP-scoped writes) the
  `FspAccessGuard` ownership fence; mirror the rule in the frontend `access.ts`.
- Match the surrounding code: these files are heavily commented with the
  *why* (especially the proc quirks). Keep that current when behavior changes.

Pull requests are evaluated by the repository guardians on a schedule and, if
deemed beneficial, merged to `main`.

## Testing

| | Command |
|---|---|
| Backend | `mvn test` (in `backend/`) |
| Frontend type check | `npm run typecheck` (in `frontend/`) |
| End-to-end | `npm run e2e` (see [frontend/e2e/README.md](./frontend/e2e/README.md)) |

There is no frontend unit-test or lint setup yet — `typecheck` and the
Playwright e2e suite are the gates. Add or update tests with behavior changes,
especially controller/role tests for anything security-related.

## License

All contributors retain the original copyright to their work, but by
contributing you grant a world-wide, royalty-free, perpetual, irrevocable,
non-exclusive, transferable license to all users **under the terms of the
[license](./LICENSE) under which this project is distributed**.
