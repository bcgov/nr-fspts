import { expect, test, type Page, type Route } from './fixtures';

/**
 * InboxPage end-to-end coverage.
 *
 * Mirrors search.spec.ts: mocks the backend endpoints the page touches
 * (/code-lists/org-units, /fsp/inbox, /clients/search) and walks the
 * happy paths via accessible locators. Auth state is supplied by the
 * Cognito cookie storageState produced by e2e/auth.setup.ts (run
 * `npm run e2e:login` first locally; CI runs it programmatically via
 * E2E_IDIR_USER / E2E_IDIR_PASSWORD secrets).
 */

const ORG_UNITS = [
  { code: '1826', description: 'DPG – Penticton' },
  { code: '1827', description: 'DSE – Skeena' },
  { code: '1828', description: 'DQU – Quesnel' },
];

// Same shape SearchPage's mock uses, but only the inbox-cursor fields
// the InboxPage actually renders (status, planSubmissionDate,
// updateUserid, extensionNumber). The FSP-100-only fields stay null
// because fsp_200_inbox doesn't populate them.
const makeInboxResponse = (params: URLSearchParams, total = 25) => {
  const page = Number(params.get('page') ?? '0');
  const size = Number(params.get('size') ?? '10');
  const startIdx = page * size;
  const endIdx = Math.min(startIdx + size, total);
  const content = Array.from({ length: Math.max(0, endIdx - startIdx) }, (_, i) => {
    const idx = startIdx + i;
    return {
      fspId: String(20000 + idx),
      planName: `Inbox Plan ${idx}`,
      fspAmendmentName: null,
      fspAmendmentNumber: String(idx % 4),
      orgUnitCode: null,
      planStartDate: null,
      planEndDate: null,
      planSubmissionDate: '2026-04-15',
      agreementHolder: 'Tolko Industries',
      amendmentApprovalRequirdInd: null,
      extensionNumber: idx % 5 === 0 ? null : String(idx % 5),
      updateUserid: 'jsmith',
      fspStatusDesc: 'Submitted',
      // Alternate FDU count so half the rows render a Map View link
      // and half don't — gives the trailing-column test something to
      // assert against in both states.
      numberOfFdu: idx % 2 === 0 ? 3 : 0,
    };
  });
  return {
    content,
    page: {
      size,
      number: page,
      totalElements: total,
      totalPages: Math.ceil(total / size),
    },
  };
};

const CLIENT_HITS = [
  {
    clientNumber: '00012345',
    clientAcronym: 'TOLKO',
    displayClientNumber: 'TOLKO',
    clientName: 'Tolko Industries Ltd.',
    legalFirstName: null,
    legalMiddleName: null,
    clientLocnCode: '01',
    clientLocnName: 'Head Office',
    city: 'Vernon',
    clientStatusCode: 'ACT',
  },
];

async function seedInboxApp(page: Page) {
  const inboxCalls: URLSearchParams[] = [];

  await page.route('**/api/v1/fsp/code-lists/org-units', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ORG_UNITS),
    }),
  );

  // The InboxPage doesn't hit /code-lists/fsp-status (it uses a
  // hardcoded inbox status list — see STATUS_OPTIONS comment), so we
  // intentionally don't mock that route. An unexpected call would fail
  // the test, which is the diagnostic we want if someone accidentally
  // adds it back.

  await page.route('**/api/v1/fsp/inbox**', (route: Route) => {
    const url = new URL(route.request().url());
    inboxCalls.push(url.searchParams);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeInboxResponse(url.searchParams)),
    });
  });

  await page.route('**/api/v1/clients/search**', (route: Route) => {
    const url = new URL(route.request().url());
    const page0 = Number(url.searchParams.get('page') ?? '0');
    const size0 = Number(url.searchParams.get('size') ?? '10');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: CLIENT_HITS,
        page: {
          size: size0,
          number: page0,
          totalElements: CLIENT_HITS.length,
          totalPages: 1,
        },
      }),
    });
  });

  return { inboxCalls };
}

test.describe('FSP Inbox', () => {
  test('loads the form once org units resolve', async ({ page }) => {
    await seedInboxApp(page);
    await page.goto('/inbox');

    // H1 visibility is the proxy for "code list resolved, form shown" —
    // until then the page renders only the centered spinner.
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    // Org-unit dropdown populated from the mocked code-list response.
    await expect(page.getByLabel('Organization Unit')).toBeVisible();
    await expect(page.getByLabel('Organization Unit')).toContainText('DPG – Penticton');

    // Status dropdown is hardcoded (not code-list backed); confirm it
    // still has the inbox-specific values per the legacy spec.
    await expect(page.getByLabel('Status')).toContainText('Submitted');
    await expect(page.getByLabel('Status')).toContainText('Opportunity to be Heard Sent');
  });

  test('runs an inbox query and asserts default sort', async ({ page }) => {
    const { inboxCalls } = await seedInboxApp(page);
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    // Scope to the form because the SideNav has its own "Inbox" link
    // (clickable button-role element) that the form's submit button
    // collides with on a naive role lookup.
    await page
      .locator('.fsp-inbox__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();

    await expect(page.getByRole('cell', { name: 'Inbox Plan 0' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Inbox Plan 9' })).toBeVisible();

    // Default sort is the two-column status/submission-date sort the
    // legacy inbox used — pinned via InboxPage's SORT_BY / SORT_DIR
    // constants. The backend's InboxService.buildComparator parses
    // these as comma-delimited lists. Status first puts the "live"
    // statuses (Submitted, OHS, Rejected) near the top, and the
    // submission date breaks ties so the most recent FSP in each
    // status group leads. Pinning this in the test means a future
    // change that drops or flips either column fails loudly here.
    expect(inboxCalls.length).toBeGreaterThan(0);
    const first = inboxCalls[0];
    expect(first.get('sortBy')).toBe('fspStatusDesc,planSubmissionDate');
    expect(first.get('sortDir')).toBe('desc,desc');
    expect(first.get('page')).toBe('0');
    expect(first.get('size')).toBe('10');
  });

  test('pagination fetches the next page', async ({ page }) => {
    const { inboxCalls } = await seedInboxApp(page);
    await page.goto('/inbox');
    await page
      .locator('.fsp-inbox__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: 'Inbox Plan 0' })).toBeVisible();

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('cell', { name: 'Inbox Plan 10' })).toBeVisible();

    const last = inboxCalls[inboxCalls.length - 1];
    expect(last.get('page')).toBe('1');
  });

  test('Map View column renders triggers only for rows with FDUs', async ({ page }) => {
    await seedInboxApp(page);
    await page.goto('/inbox');
    await page
      .locator('.fsp-inbox__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: 'Inbox Plan 0' })).toBeVisible();

    // Even-indexed rows in makeInboxResponse have numberOfFdu: 3, odd
    // rows have 0. Page size is 10 → 5 even rows on page 0 → 5 rows each
    // render a "Map View" button that opens the in-app Leaflet map.
    const triggers = page.locator('.fsp-inbox__map-link');
    await expect(triggers).toHaveCount(5);
    await expect(triggers.first()).toHaveText('Map View');
  });

  test('Map View click opens the Leaflet map page in a new tab', async ({ page, context }) => {
    await seedInboxApp(page);

    // Capture the URL the new tab navigates to and short-circuit the real
    // SPA load. The link opens our own `/fsp/map` Leaflet page (no external
    // arcmaps hand-off, no extent pre-fetch). Regex matcher for robustness
    // against the query string.
    const mapRequests: string[] = [];
    await context.route(/\/fsp\/map/, (route: Route) => {
      mapRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>map stub</body></html>',
      });
    });

    // The inbox no longer pre-fetches an extent — assert none fires.
    const extentCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/extent')) extentCalls.push(req.url());
    });

    await page.goto('/inbox');
    await page
      .locator('.fsp-inbox__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: 'Inbox Plan 0' })).toBeVisible();

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('.fsp-inbox__map-link').first().click(),
    ]);

    // New tab points at the Leaflet map for row 0 (fspId=20000, amendNo=0
    // per makeInboxResponse) — no arcmaps, no extent call.
    await expect.poll(() => mapRequests.length).toBeGreaterThanOrEqual(1);
    const mapUrl = mapRequests[0];
    expect(mapUrl).toContain('/fsp/map');
    expect(mapUrl).toContain('fspId=20000');
    expect(mapUrl).toContain('amendmentNumber=0');
    expect(extentCalls).toHaveLength(0);
    await popup.close();
  });

  test('client-picker populates the Agreement Holder field', async ({ page }) => {
    await seedInboxApp(page);
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    // Agreement Holder is now a ComboBox autocomplete (the old "Search for
    // client" modal was retired). Typing >= 3 chars fires the mocked
    // /clients/search, which returns our TOLKO fixture row.
    const holder = page.getByRole('combobox', { name: 'Agreement holder' });
    await holder.click();
    await holder.fill('tol');

    await page.getByRole('option', { name: /TOLKO/ }).first().click();

    // The ComboBox now displays the picked client's label.
    await expect(holder).toHaveValue(/TOLKO/);
  });
});
