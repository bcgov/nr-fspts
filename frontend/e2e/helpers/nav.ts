import { expect, type Page } from '@playwright/test';

import { gotoProtected } from '../utils';

/**
 * Every top-level page in the SPA, keyed by a short id. `navId` is the
 * SideNav link's `data-testid` suffix (`side-nav-link-<navId>`) when the
 * entry appears in the menu; pages reachable only by deep link (FSP
 * Information) have no navId. `heading` is the page's <h1> text, used as
 * the "page rendered" signal.
 *
 * Kept in one place so the smoke spec and the feature specs agree on
 * paths + headings, and so a renamed route/heading fails in exactly one
 * spot.
 */
export interface PageDef {
  path: string;
  heading: string | RegExp;
  navId?: string;
}

export const PAGES = {
  dataSubmission: { path: '/data-submission', heading: 'Data Submission', navId: 'Data Submission' },
  fspSearch: { path: '/search', heading: 'FSP Search', navId: 'FSP Search' },
  inbox: { path: '/inbox', heading: 'Inbox', navId: 'Inbox' },
  standardsSearch: {
    path: '/standards-search',
    heading: 'Stocking Standards Search',
    navId: 'Standards Search',
  },
  reports: { path: '/reports/jcrs', heading: 'Reports', navId: 'Reports' },
  districtNotification: {
    path: '/admin/district-notification',
    heading: 'District Notification',
    navId: 'District Notification',
  },
  submissionHistory: {
    path: '/submission-history',
    heading: 'Submission History',
    navId: 'Submission History',
  },
} satisfies Record<string, PageDef>;

/**
 * Navigate to a page by URL (not by clicking the nav) and assert its
 * heading renders. Uses gotoProtected so a stuck loading overlay / role
 * bounce produces a diagnostic dump instead of a bare timeout.
 */
export async function gotoPage(page: Page, def: PageDef): Promise<void> {
  await gotoProtected(page, def.path);
  await expect(page.getByRole('heading', { name: def.heading, level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Navigate by clicking the SideNav link, exercising the menu itself.
 * Falls back to a direct goto when the entry isn't in this user's menu
 * (e.g. District Notification for a non-admin) so callers can still
 * assert the route guard's behaviour.
 */
export async function navClick(page: Page, def: PageDef): Promise<void> {
  if (!def.navId) {
    throw new Error(`navClick called for a page with no navId (path=${def.path})`);
  }
  await page.getByTestId(`side-nav-link-${def.navId}`).click();
  await expect(page).toHaveURL(new RegExp(def.path.replace(/\//g, '\\/')));
  await expect(page.getByRole('heading', { name: def.heading, level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}
