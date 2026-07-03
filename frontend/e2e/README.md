# FSP end-to-end tests

Playwright suite that drives the real SPA against a real backend (auth,
Oracle, FAM). Mirrors nr-rept's setup: one `setup` project authenticates
via IDIR and saves `e2e/.auth/user.json`; every other project boots from
that storageState.

## Running

```bash
# 1. Point at a target (no default — fail fast beats a stale URL)
export E2E_BASE_URL=http://localhost:3000      # or a deployed slot

# 2. Log in once (interactive, headed) — caches e2e/.auth/user.json
npm run e2e:login

# 3. Run
npm run e2e                # chromium
npm run e2e:ui             # Playwright UI mode
npm run e2e:all-browsers   # every project
```

In CI, `auth.setup.ts` logs in programmatically from `E2E_IDIR_USER` /
`E2E_IDIR_PASSWORD` (see `.github/workflows/reusable-tests.yml`).

## What's covered

| Spec | Backend | Notes |
|------|---------|-------|
| `smoke.spec.ts` | real | root 200 |
| `pages.smoke.spec.ts` | real | every page's `<h1>` renders + an unknown-FSP not-found |
| `searches.live.spec.ts` | real | runs a real query on FSP / Inbox / Standards search |
| `reports.spec.ts` | real | generates the FSP Summary PDF |
| `district-notification.spec.ts` | real | add then remove a designate |
| `fsp-lifecycle.spec.ts` | real | submit XML → edit → attach → submit → approve → amend → delete |
| `reviewer-enforcement.spec.ts` | real | direct write call → 403 for read-only roles, allowed for editors |
| `inbox.spec.ts` | **mocked** | pins Inbox UI behaviour against `page.route` stubs |
| `search.spec.ts` | **mocked** | pins FSP Search UI behaviour |

The `*.live.spec.ts` and lifecycle/reports/district specs hit the proc
layer; the two mocked specs deliberately stub the API to lock UI
behaviour without a backend.

## Prerequisites for the stateful specs

These need more than a logged-in user:

- **Editor role.** The lifecycle (submit/edit/approve) and District
  Notification specs need an account with an **edit role**
  (Administrator / Decision Maker / Submitter; approval + the Workflow
  tab specifically need Administrator or Decision Maker). A **read-only**
  login (Reviewer / View-All / View-Only) now has its edit affordances
  hidden in the UI *and* its writes rejected with 403 by the backend, so
  those editor flows will fail — run them with an editor storageState.
  `reviewer-enforcement.spec.ts` is the exception: it reads the session
  role off the bearer and asserts the matching outcome, so it's correct
  for any account.
- **Reference data.** `fixtures/initial-submission.xml` references real
  clients (`00001271`, `00161366`), district `DMK`, and licence
  `A15384`. They exist in the canonical DEV/TEST reference tables (the
  backend's `valid-mackenzie` fixture uses the same values). Against a
  DB without them, the submission validates-fails.
- **A directory user for District Notification.** Set
  `E2E_DISTRICT_DESIGNATE` to an IDIR username to add/remove; otherwise
  it falls back to `E2E_IDIR_USER`, and skips if neither is set.
- **A reachable virus scanner — or fail-open.** The `fsp-lifecycle`
  spec uploads a file, which the backend virus-scans first. If the
  target backend has ClamAV enabled and fail-**closed** but can't reach
  clamd, the upload is rejected with "Virus scan unavailable" and the
  spec fails at the validate step. Point it at a backend with a reachable
  clamd, or one running fail-open (`CLAMAV_FAIL_OPEN=true`, the local-dev
  default). See [../../docs/virus-scanning.md](../../docs/virus-scanning.md).

## Keeping the DB clean

Attachments are generated in-memory at byte scale (`helpers/tinyFiles.ts`)
— a ~30-byte text file and a ~300-byte PDF — and the lifecycle FSP uses a
tiny single-FDU polygon, so a run writes only a handful of disposable
rows. The lifecycle deletes its amendment at the end; the Draft FSP it
creates is left behind (no UI delete once approved) and is named
`E2E FSP <suffix>` for easy identification/cleanup.
