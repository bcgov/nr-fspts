import { expect, test, type Page } from './fixtures';

import { gotoProtected } from './utils';

/**
 * Backend role-enforcement check from the real stack: a read-only role
 * (Reviewer / View-All / View-Only) must be denied (403) on a write
 * endpoint even when it bypasses the UI and calls the API directly,
 * while an editor (Administrator / Decision Maker / Submitter) must pass
 * the authorization gate.
 *
 * The probe is self-adapting: it reads the session's own
 * {@code cognito:groups} off the bearer and asserts the outcome that
 * matches that role — so it verifies enforcement whichever account runs
 * it (a Reviewer locally, an editor service account in CI).
 *
 * We hit the submission *validate* endpoint (guarded by
 * FspAuthorities.CONTENT_EDIT): a dry-run with no per-FSP access fence
 * and no persistence, so the only 403 source is the role gate. (Per-FSP
 * write endpoints are unsuitable: a bogus id trips the proc's no-access
 * fence — also 403 — for everyone, masking the role gate.)
 */

const WRITE_PATH = '/api/v1/fsp/submissions/validate';

// Mirrors FspAuthorities.CONTENT_EDIT on the backend — Administrator and
// Submitter only. Decision Maker is workflow-only (not a content editor),
// so a DDM session is denied on this content-write probe.
const EDIT_ROLES = ['FSPTS_ADMINISTRATOR', 'FSPTS_SUBMITTER'];

/** A cognito group counts as an edit role if it equals or is an org-suffixed variant. */
const isEditRole = (group: string): boolean =>
  EDIT_ROLES.some((r) => group === r || group.startsWith(`${r}_`));

function decodeGroups(bearer: string): string[] {
  const jwt = bearer.replace(/^Bearer /, '');
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
  const groups = payload['cognito:groups'];
  return Array.isArray(groups) ? groups : [];
}

interface Probe {
  status: number;
  groups: string[];
  editor: boolean;
}

/**
 * Bootstrap auth, capture the bearer + API origin from the app's own
 * traffic, decode the session role, then fire a direct write POST.
 */
async function probeWrite(page: Page): Promise<Probe> {
  let authorization: string | undefined;
  let apiOrigin: string | undefined;
  page.on('request', (req) => {
    const m = /^(https?:\/\/[^/]+)\/api\/v1\//.exec(req.url());
    if (m && !authorization) {
      const header = req.headers()['authorization'];
      if (header) {
        authorization = header;
        apiOrigin = m[1];
      }
    }
  });

  // gotoProtected only returns once the layout has rendered — i.e. auth
  // bootstrapped — so by then the code-list GETs have fired and we've
  // captured a bearer.
  await gotoProtected(page, '/search');
  await expect
    .poll(() => authorization, {
      timeout: 30_000,
      message: 'never observed an authenticated /api/v1 request to copy the bearer from',
    })
    .toBeTruthy();

  const groups = decodeGroups(authorization!);
  const editor = groups.some(isEditRole);

  // Multipart so the request matches the endpoint's
  // consumes=multipart/form-data (otherwise Spring 415s before the
  // security gate). The content is junk — an allowed role gets a
  // validation error, never a successful submission.
  const res = await page.request.post(`${apiOrigin}${WRITE_PATH}`, {
    headers: { authorization: authorization! },
    multipart: {
      file: { name: 'probe.xml', mimeType: 'application/xml', buffer: Buffer.from('<probe/>') },
    },
    failOnStatusCode: false,
  });
  return { status: res.status(), groups, editor };
}

test('write endpoints enforce the session role (read-only → 403)', async ({ page }) => {
  const { status, groups, editor } = await probeWrite(page);
  if (editor) {
    expect(status, `editor session ${JSON.stringify(groups)} must clear the authz gate`).not.toBe(
      403,
    );
  } else {
    expect(status, `read-only session ${JSON.stringify(groups)} must be forbidden`).toBe(403);
  }
});

// Optional explicit Reviewer check for environments whose default
// account is an editor (e.g. CI). Point E2E_REVIEWER_STORAGE at a
// storageState captured from a Reviewer login; otherwise it skips. The
// context is built by hand so the reviewer state stays isolated.
const reviewerStorage = process.env.E2E_REVIEWER_STORAGE;

test('explicit Reviewer storageState is denied (403)', async ({ browser }) => {
  test.skip(
    !reviewerStorage,
    'Set E2E_REVIEWER_STORAGE to a Reviewer storageState to run this explicit check.',
  );
  const context = await browser.newContext({ storageState: reviewerStorage });
  try {
    const page = await context.newPage();
    const { status, groups } = await probeWrite(page);
    expect(status, `reviewer session ${JSON.stringify(groups)} must be forbidden`).toBe(403);
  } finally {
    await context.close();
  }
});
