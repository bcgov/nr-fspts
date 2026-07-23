import { test as base } from '@playwright/test';

import { STORAGE_STATE } from './utils';

/**
 * Shared E2E test object. Use this instead of importing `test` straight from
 * `@playwright/test` so every spec gets the rotated-token persistence below.
 *
 * WHY: the Cognito app client has **refresh-token rotation** enabled — each
 * refresh mints a new refresh token and invalidates the previous one, and
 * Cognito's reuse-detection revokes the entire token family if a rotated
 * token is presented again. Every test context is created from the same
 * static `storageState` file (see playwright.config.ts), so without this,
 * test 1 rotates the shared refresh token and test 2 reloads the now-stale
 * file → refresh → `RefreshTokenReuseException` → cascading auth failure
 * across the whole suite.
 *
 * FIX: after each test, write the context's storage (cookies + localStorage,
 * where Amplify keeps the Cognito tokens) back to `STORAGE_STATE`, so the
 * next test loads the latest, still-valid refresh token. Safe because the
 * suite runs serially (workers: 1) — no two contexts ever use the same token
 * concurrently. The `auth.setup` project is unaffected (it saves state itself
 * and imports the base `test`).
 */
export const test = base.extend<{ persistRotatedTokens: void }>({
  persistRotatedTokens: [
    async ({ context }, use) => {
      await use();
      // The context may already be closed if a test tore it down itself;
      // ignore — the next test just falls back to the prior snapshot.
      await context.storageState({ path: STORAGE_STATE }).catch(() => undefined);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
export type { Page, Route } from '@playwright/test';
