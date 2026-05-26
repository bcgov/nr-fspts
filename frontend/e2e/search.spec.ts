import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * SearchPage end-to-end coverage.
 *
 * The page sits behind auth, so each test seeds a fake session into
 * sessionStorage via addInitScript (runs before the SPA boots) and
 * mocks all backend endpoints via page.route. This keeps the suite
 * runnable against a static dev server with no real Cognito flow and
 * no real backend — and crucially, deterministic. Real-auth coverage
 * lives upstream in the reusable-tests.yml CI workflow once the
 * E2E_IDIR_USER credentials are wired up.
 */

// Matches the shape src/auth/auth.ts persists under sessionStorage
// key 'auth.session'. expiresAt is set 1 hour out so getAccessToken()
// short-circuits without triggering a refresh round-trip.
const FAKE_SESSION = {
  idToken: 'fake-id-token',
  accessToken: 'fake-access-token',
  refreshToken: null,
  expiresAt: Date.now() + 60 * 60 * 1000,
  user: {
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    email: 'test.user@gov.bc.ca',
    username: 'tuser',
    roles: ['FSPTS_ADMINISTRATOR'],
    claims: {},
  },
};

// Sample code lists. The shape matches backend CodeOption.
const ORG_UNITS = [
  { code: '1001', description: 'DPG – Penticton' },
  { code: '1002', description: 'DSE – Skeena' },
  { code: '1003', description: 'DQU – Quesnel' },
];

const STATUS_CODES = [
  { code: 'DFT', description: 'Draft' },
  { code: 'SUB', description: 'Submitted' },
  { code: 'APP', description: 'Approved' },
];

// Builds a PageableResponse<FspSearchResult> with `total` rows; the
// returned page is sliced to whatever page/size the request carries.
// Letting the mock honour those params is what makes the pagination
// assertions meaningful — clicking page 2 actually shows different
// content.
const makeSearchResponse = (params: URLSearchParams, total = 25) => {
  const page = Number(params.get('page') ?? '0');
  const size = Number(params.get('size') ?? '10');
  const startIdx = page * size;
  const endIdx = Math.min(startIdx + size, total);
  const content = Array.from({ length: Math.max(0, endIdx - startIdx) }, (_, i) => {
    const idx = startIdx + i;
    return {
      fspId: String(10000 + idx),
      planName: `Plan ${idx}`,
      fspAmendmentName: idx % 2 === 0 ? '' : `Amend ${idx}`,
      fspAmendmentNumber: String(idx % 5),
      orgUnitCode: 'DPG',
      planStartDate: '2023-04-01',
      planEndDate: '2028-03-31',
      planSubmissionDate: null,
      agreementHolder: 'Tolko Industries',
      amendmentApprovalRequirdInd: idx % 3 === 0 ? 'Y' : 'N',
      extensionNumber: null,
      updateUserid: null,
      fspStatusDesc: 'Approved',
      numberOfFdu: null,
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
  {
    clientNumber: '00067890',
    clientAcronym: 'CANFOR',
    displayClientNumber: 'CANFOR',
    clientName: 'Canfor Corporation',
    legalFirstName: null,
    legalMiddleName: null,
    clientLocnCode: '02',
    clientLocnName: 'Vancouver Branch',
    city: 'Vancouver',
    clientStatusCode: 'ACT',
  },
];

/**
 * Sets up `page.route` mocks and seeds the fake session. Returns a
 * `searchCalls` array the test can inspect to assert which page
 * fetches happened.
 */
async function seedFspApp(page: Page) {
  const searchCalls: URLSearchParams[] = [];

  // session seed — must run before the SPA's main.tsx, so addInitScript
  // is the right hook (page.evaluate would race the React boot).
  await page.addInitScript((session) => {
    window.sessionStorage.setItem('auth.session', JSON.stringify(session));
  }, FAKE_SESSION);

  await page.route('**/api/v1/fsp/code-lists/org-units', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ORG_UNITS),
    }),
  );

  await page.route('**/api/v1/fsp/code-lists/fsp-status', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STATUS_CODES),
    }),
  );

  await page.route('**/api/v1/fsp/search**', (route: Route) => {
    const url = new URL(route.request().url());
    searchCalls.push(url.searchParams);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeSearchResponse(url.searchParams)),
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

  return { searchCalls };
}

test.describe('FSP Search', () => {
  test('loads the form once code tables resolve', async ({ page }) => {
    await seedFspApp(page);
    await page.goto('/search');

    // The page renders a centered Loading spinner until BOTH code-list
    // promises resolve; the H1 "Search" appears in the same JSX block
    // that mounts the form so its visibility is a sufficient proxy
    // for "code tables done loading".
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();

    // Dropdowns get populated from the mocked code-list endpoints —
    // a value beyond the "All …" placeholder confirms the fetch ran
    // and we parsed the response shape correctly.
    await expect(page.getByLabel('Organization Unit')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Status')).toContainText('Draft');
  });

  test('runs a search and renders results', async ({ page }) => {
    const { searchCalls } = await seedFspApp(page);
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();

    // Use the submit button rather than form submission via Enter to
    // mirror what a real user does — and to exercise the button-icon
    // swap to the "Searching..." state.
    // Scope to the main page's form — the SideNav also has a "Search"
    // sub-menu (a button with aria-expanded="true" when on /search)
    // and the Agreement Holder field's icon button has accessible name
    // "Search for client" — both would otherwise collide with this
    // locator. `exact: true` pins the match to the submit button.
    await page
      .locator('.fsp-search__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();

    // Wait for at least one row in the results table. The table only
    // renders when results.length > 0, so this implicitly asserts the
    // mocked response was consumed correctly.
    await expect(page.getByRole('cell', { name: 'Plan 0' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Plan 9' })).toBeVisible();

    // First call should be page=0, sort=fspId desc. Assertion is
    // explicit so a future change that drops the sort param fails
    // loudly here rather than silently shifting the result order.
    expect(searchCalls.length).toBeGreaterThan(0);
    const first = searchCalls[0];
    expect(first.get('page')).toBe('0');
    expect(first.get('size')).toBe('10');
    expect(first.get('sortBy')).toBe('fspId');
    expect(first.get('sortDir')).toBe('desc');
  });

  test('pagination fetches the next page', async ({ page }) => {
    const { searchCalls } = await seedFspApp(page);
    await page.goto('/search');
    // Scope to the main page's form — the SideNav also has a "Search"
    // sub-menu (a button with aria-expanded="true" when on /search)
    // and the Agreement Holder field's icon button has accessible name
    // "Search for client" — both would otherwise collide with this
    // locator. `exact: true` pins the match to the submit button.
    await page
      .locator('.fsp-search__form')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.getByRole('cell', { name: 'Plan 0' })).toBeVisible();

    // Carbon Pagination's "next" button has aria-label "Next page".
    // Click → backend receives page=1 → row labels in the table
    // shift to the second slice we generated in makeSearchResponse.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('cell', { name: 'Plan 10' })).toBeVisible();

    // The second call should ask for page=1 (Pagination is 1-indexed
    // in the UI, 0-indexed on the wire — converted by handlePagination).
    const last = searchCalls[searchCalls.length - 1];
    expect(last.get('page')).toBe('1');
  });

  test('client-picker populates the Agreement Holder field', async ({ page }) => {
    await seedFspApp(page);
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();

    // The trigger is an icon-only ghost Button with iconDescription
    // "Search for client" → Carbon renders that as accessible name.
    await page.getByRole('button', { name: 'Search for client' }).click();

    // Modal heading confirms the dialog opened.
    await expect(page.getByRole('heading', { name: 'Client Search' })).toBeVisible();

    // The modal hosts its own form. Submitting it with no criteria
    // fires the mocked search and produces our two rows; the per-row
    // Select button is what we're after.
    await page
      .locator('.client-search-modal')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    // exact: true so "TOLKO" (acronym cell) doesn't also match
    // "Tolko Industries Ltd." (client-name cell) in the same row.
    await expect(page.getByRole('cell', { name: 'TOLKO', exact: true })).toBeVisible();

    // Click the first Select button — there is one per row, so be
    // explicit about which row we pick to avoid first()-strict-mode
    // ambiguity if Carbon ever renders multiple visible row actions.
    await page
      .getByRole('row', { name: /TOLKO/ })
      .getByRole('button', { name: 'Select' })
      .click();

    // Modal closes; Agreement Holder text input gets the picked
    // client_number. Reading via getByLabel resolves to the Carbon
    // TextInput's underlying <input>.
    await expect(page.getByRole('heading', { name: 'Client Search' })).not.toBeVisible();
    await expect(page.getByLabel('Agreement Holder')).toHaveValue('00012345');
  });

  // Date-range cross-field validation (form.dateFrom > form.dateTo
  // short-circuits runSearch before any fetch fires) is intentionally
  // not exercised via the UI. Driving Carbon's DatePicker through
  // synthetic input events doesn't reliably round-trip through
  // flatpickr's parser to fire onChange, so the test was flaky. Worth
  // a Vitest unit test against runSearch directly once we add a unit
  // test framework.
});
