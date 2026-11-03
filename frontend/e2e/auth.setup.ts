import { existsSync, writeFileSync } from 'node:fs';

import { test as setup, expect, type Locator, type Page } from '@playwright/test';

import { freshTotp } from './totp';
import { SESSION_STORAGE_STATE, STORAGE_STATE } from './utils';

/**
 * Auth setup. Runs once per `playwright test` invocation, as a dependency of
 * every browser project. Three behaviours, in priority order:
 *
 *   1. Both saved-state files already exist → do nothing (cached state).
 *   2. E2E_IDIR_USER + E2E_IDIR_PASSWORD are set → drive the IDIR login
 *      programmatically. See the MFA note below before relying on this.
 *   3. Neither of the above → fall back to the interactive flow: open the
 *      headed browser and wait up to 5 minutes for a human to complete the
 *      IDIR sign-in. Used locally via `npm run e2e:login`.
 *
 * Re-run `npm run e2e:login` whenever the saved tokens expire (symptom: tests
 * bouncing to the login domain or hitting 401s). **That window is now 30
 * minutes, not 60** — the BC Gov SSO refresh token is half the life of the
 * Cognito one it replaced, so cached state goes stale twice as fast.
 *
 * ## Programmatic login and MFA
 *
 * FSP signs in through the standard realm's **IDIR - MFA** integration, which
 * federates to Azure AD and requires a second factor. When
 * E2E_IDIR_TOTP_SECRET is set, it is satisfied by generating the same 6-digit
 * code an authenticator app would (see e2e/totp.ts), per
 * https://bcgov.github.io/sso-docs/advanced/automating-mfa-totp. The secret is
 * the base32 key from My Sign-Ins → Add sign-in method → Microsoft Authenticator
 * → "Set up a different authentication app" → "Can't scan QR code?".
 *
 * Without the secret, the programmatic path only works for an account whose MFA
 * is satisfied without interaction (a conditional-access exemption).
 */

/**
 * Fills an input without the value reaching the HTML report. `fill()`,
 * `pressSequentially()` and the keyboard APIs all put the value in their step
 * title (`Fill "<password>"`), and CI uploads that report as an artifact;
 * `evaluate()` is titled just "Evaluate". The input event is what the
 * Microsoft form's bindings listen for, so this reads as typing to them.
 */
const fillSecret = async (locator: Locator, value: string): Promise<void> => {
  await locator.waitFor();
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.focus();
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

/**
 * Answers the Entra MFA prompt with a TOTP code. If the account's default
 * method is something else (usually an Authenticator push), switches to
 * "Use a verification code" first. If no MFA prompt shows up at all, returns
 * quietly — conditional access doesn't always ask.
 */
const completeTotpChallenge = async (page: Page, secret: string): Promise<void> => {
  const codeInput = page.locator('input[name="otc"], #idTxtBx_SAOTCC_OTC').first();
  const otherWay = page.locator('#signInAnotherWay').first();
  const backToApp = page.waitForURL((url) => url.pathname.startsWith(LANDING), {
    timeout: 30_000,
  });

  const first = await Promise.race([
    codeInput.waitFor({ timeout: 30_000 }).then(() => 'code' as const),
    otherWay.waitFor({ timeout: 30_000 }).then(() => 'other' as const),
    backToApp.then(() => 'done' as const),
  ]).catch(() => 'none' as const);
  backToApp.catch(() => undefined);

  if (first === 'done' || first === 'none') return;

  if (first === 'other') {
    await otherWay.click();
    await page.locator('[data-value="PhoneAppOTP"]').first().click();
    await codeInput.waitFor({ timeout: 30_000 });
  }

  await fillSecret(codeInput, await freshTotp(secret));
  await page
    .locator('#idSubmit_SAOTCC_Continue, input[type="submit"], button[type="submit"]')
    .first()
    .click();
};

/**
 * Clears the screens Microsoft can show between MFA and the redirect back to
 * the app, in whatever order they come:
 *
 *   - "Pick an account": appears after the code is accepted, listing the
 *     account as "Signed in". The tile is matched on the user's address so a
 *     stray second tile is never picked.
 *   - "Stay signed in?": answered No.
 *
 * Returns once the app is back on /search, or after 60s; the caller's own
 * waitForURL is what fails the run if the redirect never comes.
 */
const finishPostMfaPrompts = async (page: Page, idirUser: string): Promise<void> => {
  const localPart = idirUser.split('\\').pop()!.split('@')[0];
  const escaped = localPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const pickAccount = page.getByRole('heading', { name: /pick an account/i });
  const accountTile = page.getByText(new RegExp(`^${escaped}@`, 'i')).first();
  const staySignedIn = page.locator('input#idBtn_Back, input[value="No"]').first();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (new URL(page.url()).pathname.startsWith(LANDING)) return;

    if (await pickAccount.isVisible().catch(() => false)) {
      await accountTile.click();
      await pickAccount.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
    } else if (await staySignedIn.isVisible().catch(() => false)) {
      await staySignedIn.click();
      await staySignedIn.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
    } else {
      await page.waitForTimeout(500);
    }
  }
};

/** Where the internal test user lands after sign-in (routes/access.ts). */
const LANDING = '/search';

setup('authenticate via IDIR', async ({ page, context }) => {
  // Both halves are required. The tokens live in sessionStorage, so a stale
  // user.json on its own is not a session — see e2e/utils.ts.
  if (existsSync(STORAGE_STATE) && existsSync(SESSION_STORAGE_STATE)) {
    return;
  }

  const idirUser = process.env.E2E_IDIR_USER;
  const idirPassword = process.env.E2E_IDIR_PASSWORD;
  const totpSecret = process.env.E2E_IDIR_TOTP_SECRET;
  const programmatic = Boolean(idirUser && idirPassword);

  await page.goto('/');
  await page.getByTestId('landing-button__idir').click();

  if (programmatic) {
    // The sign-in pages are on other origins: Keycloak (loginproxy) hands off
    // to Azure AD (login.microsoftonline.com) because of the `azureidir` IdP
    // hint. The Microsoft form is what the selectors below target — the old
    // Siteminder/Logon7 `input[name="user"]` fields belonged to Cognito's
    // federation path and no longer appear.
    await page.waitForURL(/loginproxy|login\.microsoftonline\.com|logon/i, { timeout: 60_000 });

    await page.locator('input[type="email"], input[name="loginfmt"]').first().fill(idirUser!);
    await page.locator('input[type="submit"], button[type="submit"]').first().click();

    await fillSecret(
      page.locator('input[type="password"], input[name="passwd"]').first(),
      idirPassword!,
    );
    await page.locator('input[type="submit"], button[type="submit"]').first().click();

    if (totpSecret) {
      await completeTotpChallenge(page, totpSecret);
    }

    await finishPostMfaPrompts(page, idirUser!);
  }

  // Whether interactive or programmatic, wait for the redirect back to the
  // app. The route passes through /authCallback, where the authorization code
  // is exchanged, then `/` sends the (internal) test user on to /search.
  // Interactive flow gets 5 min for a human; programmatic gets 2.
  await page.waitForURL((url) => url.pathname.startsWith(LANDING), {
    timeout: programmatic ? 2 * 60_000 : 5 * 60_000,
  });

  // Sanity check: the side menu should render once auth + roles resolve.
  // Inbox is the first universally-visible top-level entry for any internal
  // FSP user, so it's the simplest "auth landed cleanly" signal.
  await expect(page.getByTestId('side-nav-link-Inbox')).toBeVisible({
    timeout: 30_000,
  });

  await context.storageState({ path: STORAGE_STATE });

  // Saved separately because Playwright's storageState does not capture
  // sessionStorage, and that is where the tokens are.
  const session = await page.evaluate(() => JSON.stringify(window.sessionStorage));
  writeFileSync(SESSION_STORAGE_STATE, session);
});
