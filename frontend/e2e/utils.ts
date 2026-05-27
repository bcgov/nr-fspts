import path from 'node:path';

import type { Page } from '@playwright/test';

// E2E_BASE_URL is set by `.github/workflows/reusable-tests.yml` at step
// level (resolved from the PR slot or test/prod target). For local hand-runs,
// export it explicitly:
//   E2E_BASE_URL=http://localhost:3000 npm run e2e
// Failing fast here beats silently targeting a stale dev URL.
if (!process.env.E2E_BASE_URL) {
  throw new Error(
    'E2E_BASE_URL is not set. Export it before running Playwright ' +
      '(e.g. `E2E_BASE_URL=http://localhost:3000 npm run e2e`).',
  );
}

export const baseURL = process.env.E2E_BASE_URL;

/** Path to the saved auth state produced by auth.setup.ts. */
export const STORAGE_STATE = path.join(import.meta.dirname, '.auth', 'user.json');

/**
 * Unique-ish identifier suffix for test artifacts so concurrent runs and
 * leftover rows don't collide. Format: e2e-<base36 timestamp>-<rand>.
 */
export const uniqueSuffix = (): string => {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `e2e-${t}-${r}`;
};

/**
 * Navigate to a route on the protected side of the SPA and wait until the
 * Layout header has rendered — that means AuthProvider has finished
 * bootstrapping and we're past the white `<Loading withOverlay>` screen.
 *
 * On timeout, dumps current URL + a body excerpt so we can tell whether the
 * SPA stayed on the loading overlay, redirected to /unauthorized, crashed
 * into the global error boundary, etc.
 */
export const gotoProtected = async (page: Page, path: string): Promise<void> => {
  // Capture browser console messages and page errors during this navigation.
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (msg: { type(): string; text(): string }) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  };
  const onPageError = (err: Error) => {
    pageErrors.push(err.message);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(path);
    await page.getByTestId('bc-header__header').waitFor({ timeout: 60_000 });
  } catch (err) {
    const url = page.url();
    const title = await page.title().catch(() => '(unavailable)');
    const readyState = await page.evaluate(() => document.readyState).catch(() => '(unavailable)');
    const bodyHTML = await page
      .evaluate(() => document.body?.innerHTML?.slice(0, 1500) ?? '(no body)')
      .catch(() => '(unavailable)');
    const rootContent = await page
      .evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 800) ?? '(no #root)')
      .catch(() => '(unavailable)');
    const loadingVisible = await page
      .getByTestId('loading')
      .isVisible()
      .catch(() => false);
    throw new Error(
      `gotoProtected("${path}") failed to find the Layout header.\n` +
        `  Current URL  : ${url}\n` +
        `  Page title   : ${title}\n` +
        `  readyState   : ${readyState}\n` +
        `  Loading?     : ${loadingVisible}\n` +
        `  #root excerpt: ${rootContent}\n` +
        `  body excerpt : ${bodyHTML}\n` +
        `  Console (${consoleMessages.length}): ${consoleMessages.slice(-15).join(' | ') || '(none)'}\n` +
        `  Page errors (${pageErrors.length}): ${pageErrors.join(' | ') || '(none)'}\n` +
        `  Original     : ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
};
