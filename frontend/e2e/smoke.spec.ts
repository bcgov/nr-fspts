import { expect, test } from '@playwright/test';

// Sanity check — verifies the deployed frontend serves a 200 at root.
// Expand this suite as authenticated flows become testable; for now this is
// the placeholder that lets reusable-tests.yml's chromium project pass on
// fresh PRs without crashing on "No tests found".
test('root responds with 200', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status(), 'root should return 200').toBe(200);
});
