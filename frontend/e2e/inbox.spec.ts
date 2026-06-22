import { expect, test, type Page, type Route } from '@playwright/test';

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

  // Map View extent endpoint. Stubbed to mimic the live arcmaps
  // shape — a 4-tuple bounding box. We canonicalize the stub URL on
  // the fspId so each row's response is uniquely identifiable in the
  // click assertion below.
  await page.route('**/api/v1/fsp/*/amendments/*/extent', (route: Route) => {
    const match = /\/api\/v1\/fsp\/(\d+)\/amendments\/(\d+)\/extent/.exec(route.request().url());
    const fspId = match?.[1] ?? '0';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        extent: `${fspId}.1,${fspId}.2,${fspId}.3,${fspId}.4`,
      }),
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
    // rows have 0. Page size is 10 → 5 even rows on page 0 → 5 Map
    // View triggers rendered (button, not link — extent is lazy-fetched).
    const triggers = page.locator('.fsp-inbox__map-link');
    await expect(triggers).toHaveCount(5);
    await expect(triggers.first()).toHaveText('Map View');
  });

  test('Map View click fetches extent then opens arcmaps in a new tab', async ({ page, context }) => {
    await seedInboxApp(page);

    // Capture the arcmaps URL the popup tries to navigate to, and
    // short-circuit the real load (the test base URL is gated by
    // SiteMinder, so an un-stubbed request follows redirects and the
    // popup ends up on a login page rather than the URL we want to
    // assert). Regex matcher because Playwright's glob doesn't fan
    // across subdomain segments (test.arcmaps... vs arcmaps...).
    const arcmapsRequests: string[] = [];
    await context.route(/arcmaps\.gov\.bc\.ca/, (route: Route) => {
      arcmapsRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub</body></html>',
      });
    });

    // Track the extent call too so we can assert it fires on click
    // rather than on render (this is the lazy-fetch contract).
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
    expect(extentCalls).toHaveLength(0);

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('.fsp-inbox__map-link').first().click(),
    ]);

    // Extent endpoint fired with the row's fspId + amendNo (row 0:
    // fspId=20000, amendNo=0 per makeInboxResponse).
    await expect.poll(() => extentCalls.length).toBeGreaterThanOrEqual(1);
    expect(extentCalls[0]).toContain('/api/v1/fsp/20000/amendments/0/extent');

    // Arcmaps request fired with the stubbed extent
    // ("20000.1,20000.2,20000.3,20000.4") and the FSP catalogLayers.
    await expect.poll(() => arcmapsRequests.length).toBeGreaterThanOrEqual(1);
    // Legacy URL uses literal commas (no encodeURIComponent on either
    // value); see InboxPage.tsx#handleOpenMapView comment for context.
    // Asserting that exact byte form keeps a regression here if anyone
    // later "fixes" the encoding.
    const arcmapsUrl = arcmapsRequests[0];
    expect(arcmapsUrl).toContain('runWorkflow=Startup');
    expect(arcmapsUrl).toContain('Theme=FSP');
    expect(arcmapsUrl).toContain('extent=20000.1,20000.2,20000.3,20000.4');
    expect(arcmapsUrl).toContain('catalogLayers=1417,1418,1419,1420');
    await popup.close();
  });

  test('client-picker populates the Agreement Holder field', async ({ page }) => {
    await seedInboxApp(page);
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Search for client' }).click();
    await expect(page.getByRole('heading', { name: 'Client Search' })).toBeVisible();

    // Submitting the modal form with no criteria fires the mocked
    // /clients/search and produces our single fixture row.
    await page
      .locator('.client-search-modal')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    // exact: true so the acronym cell doesn't match the client-name cell.
    await expect(page.getByRole('cell', { name: 'TOLKO', exact: true })).toBeVisible();

    await page
      .getByRole('row', { name: /TOLKO/ })
      .getByRole('button', { name: 'Select' })
      .click();

    await expect(page.getByRole('heading', { name: 'Client Search' })).not.toBeVisible();
    await expect(page.getByLabel('Agreement Holder')).toHaveValue('00012345');
  });
});
