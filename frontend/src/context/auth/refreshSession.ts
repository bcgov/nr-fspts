import { ensureFreshUser, getUserManager, signOutEverywhere } from '@/services/keycloak';

/**
 * Ensures the access token is fresh before making an API call.
 *
 * - Returns immediately when the token still has comfortable life left.
 * - Renews from the refresh token when it is at or near expiry.
 * - Signs the user out and returns to the sign-in screen when the refresh token
 *   itself has expired — they were idle past the realm's thirty-minute ceiling.
 *
 * Call this at the top of every API request function (apiFetch does).
 *
 * The staleness margin lives in `services/keycloak.ts`: oidc-client-ts already
 * tracks token expiry, so the hand-rolled `exp` arithmetic and refresh-gap
 * bookkeeping this module carried under Cognito are gone.
 */
export async function ensureSessionFresh(): Promise<void> {
  try {
    // Null when nobody is signed in: nothing to renew and nothing to sign out
    // of — the route guards are already showing the public tree.
    await ensureFreshUser(getUserManager());
  } catch (error) {
    // Refresh token expired or revoked — the session is over.
    // eslint-disable-next-line no-console
    console.warn('[ensureSessionFresh] Session expired — signing out.', error);

    // signOutEverywhere reads `id_token_hint` off the stored user before
    // removing it. If the redirect itself fails, drop the tokens and go home.
    await signOutEverywhere().catch(async () => {
      await getUserManager()
        .removeUser()
        .catch(() => undefined);
      window.location.href = import.meta.env.BASE_URL || '/';
    });
  }
}
