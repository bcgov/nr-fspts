import { fetchAuthSession, signOut } from 'aws-amplify/auth';

/**
 * Seconds before access-token expiry at which we consider it "stale"
 * and force a refresh via the refresh token.
 */
const REFRESH_MARGIN_SECONDS = 30;

/**
 * Minimum gap (ms) between two consecutive refresh attempts to prevent
 * concurrent calls from each triggering their own refresh.
 */
const MIN_REFRESH_GAP_MS = 5_000;

let refreshInFlight = false;
let lastRefreshTime = 0;

/**
 * Ensures the Cognito access token is fresh before making an API call.
 *
 * - If the token has more than REFRESH_MARGIN_SECONDS remaining, returns
 *   immediately.
 * - If the token is about to expire, uses the refresh token to get a
 *   new one.
 * - If the refresh token itself has expired (user was idle too long),
 *   signs the user out and redirects to the SPA root.
 *
 * Call this at the top of every API request function (see services/*).
 */
export async function ensureSessionFresh(): Promise<void> {
  try {
    const { tokens } = (await fetchAuthSession({ forceRefresh: false })) ?? {};
    const accessToken = tokens?.accessToken;

    if (!accessToken) {
      await signOut();
      window.location.href = window.location.origin + '/';
      return;
    }

    const exp = accessToken.payload?.exp;
    if (!exp) return;

    const secondsRemaining = exp - Math.floor(Date.now() / 1000);

    if (secondsRemaining > REFRESH_MARGIN_SECONDS) return;

    if (refreshInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      return;
    }

    const now = Date.now();
    if (now - lastRefreshTime < MIN_REFRESH_GAP_MS) return;

    refreshInFlight = true;
    lastRefreshTime = now;

    try {
      await fetchAuthSession({ forceRefresh: true });
    } finally {
      refreshInFlight = false;
    }
  } catch {
    refreshInFlight = false;
    // eslint-disable-next-line no-console
    console.warn('[ensureSessionFresh] Session expired — signing out.');
    await signOut();
    window.location.href = window.location.origin + '/';
  }
}
