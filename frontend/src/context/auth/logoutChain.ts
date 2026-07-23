import { COGNITO_HOSTED_UI_DOMAIN } from '@/config/fam/config';
import { env } from '@/env';

/**
 * Builds the BC-Gov federated logout chain with Cognito firing LAST:
 *
 *   Siteminder logoff.cgi  →  Keycloak end-session  →  Cognito /logout  →  app
 *
 * Why this order (vs. Amplify's built-in sign-out, which hits Cognito first):
 * putting Cognito last means Keycloak's {@code post_logout_redirect_uri} points
 * at the *Cognito* /logout URL — one stable, app-agnostic value — so the app's
 * own URL only ever has to be registered as a **Cognito sign-out URL** (which we
 * control), never on the shared, FAM-managed Keycloak client. Cognito's
 * {@code logout_uri} is the app; the browser still carries the Cognito session
 * cookie when the chain reaches Cognito, so that final hop clears it and bounces
 * home in a single clean pass.
 *
 * Each layer is nested as the previous layer's return parameter and encoded
 * once with {@code encodeURIComponent}, so the structural {@code ?}/{@code &}
 * of an inner URL survive the outer layer's query parse instead of being
 * peeled off as the outer endpoint's own params (the bug that silently dropped
 * {@code post_logout_redirect_uri} at the logoff.cgi hop).
 *
 * @param appReturnUrl absolute URL the user lands on when fully logged out
 *   (must be a registered Cognito sign-out URL). Typically window.location.origin.
 * @returns the chain URL to navigate to, or {@code null} when any required env
 *   piece is missing — callers then fall back to the plain Amplify sign-out.
 */
export function buildFederatedLogoutUrl(appReturnUrl: string): string | null {
  const siteminderBase = env.VITE_LOGOUT_SITEMINDER_URL?.trim();
  const keycloakBase = env.VITE_LOGOUT_KEYCLOAK_URL?.trim();
  const keycloakClientId = env.VITE_LOGOUT_KEYCLOAK_CLIENT_ID?.trim();
  const cognitoClientId = env.VITE_USER_POOLS_WEB_CLIENT_ID?.trim();

  if (!siteminderBase || !keycloakBase || !keycloakClientId || !cognitoClientId) {
    return null;
  }

  // Innermost: Cognito clears its own session, then redirects to the app.
  const cognitoLogout =
    `https://${COGNITO_HOSTED_UI_DOMAIN}/logout` +
    `?client_id=${encodeURIComponent(cognitoClientId)}` +
    `&logout_uri=${encodeURIComponent(appReturnUrl)}`;

  // Keycloak clears its session, then returns to the Cognito logout URL.
  // This Cognito URL is the ONLY value that needs registering on the KC
  // client's "Valid post logout redirect URIs" — never the app URL.
  const keycloakLogout =
    `${keycloakBase}?client_id=${encodeURIComponent(keycloakClientId)}` +
    `&post_logout_redirect_uri=${encodeURIComponent(cognitoLogout)}`;

  // Outermost: Siteminder logs off the IDIR/BCeID session, then returns to
  // the Keycloak end-session URL.
  return `${siteminderBase}?retnow=1&returl=${encodeURIComponent(keycloakLogout)}`;
}
