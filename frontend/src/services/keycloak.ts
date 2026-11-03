/**
 * BC Gov SSO (Keycloak) OIDC client.
 *
 * Replaces the AWS Amplify / Cognito configuration that used to live in
 * `config/fam/config.ts`. Authorization Code + PKCE against the standard realm;
 * there is no client secret, because this is a public browser client.
 *
 * Configuration comes from `env` (Vite build-time values merged with the runtime
 * `window.config` that the container entrypoint renders), so one built image is
 * still promotable between environments. Ported from nr-rept.
 */

import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from 'oidc-client-ts';

import { env } from '@/env';
import type { LoginProvider } from '@/context/auth/types';

/**
 * The realm's identity-provider aliases, passed as `kc_idp_hint` so the user
 * goes straight to IDIR or BCeID instead of Keycloak's provider-selection screen.
 *
 * **IDIR is `azureidir`, not `idir`.** The standard realm's *IDIR - MFA*
 * integration federates IDIR through Azure AD under that alias — it is what
 * comes back in `identity_provider`, and what the backend normalises to `IDIR`
 * for the audit columns.
 *
 * Getting one wrong is not an error, which is what makes it worth stating: an
 * alias the realm does not recognise is silently ignored and Keycloak falls back
 * to its provider-selection screen (or the only provider, if there is one).
 */
export const KC_IDP_HINTS: Record<LoginProvider, string> = {
  idir: 'azureidir',
  bceid: 'bceidbusiness',
};

/** Path the realm redirects back to after a successful sign-in. */
export const AUTH_CALLBACK_PATH = '/authCallback';

/**
 * How close to expiry an access token may get before it is renewed.
 *
 * Renewing only once a token has *already* expired leaves a window where every
 * request carries a token the backend refuses. The access token lives five
 * minutes on this realm, so a minute of headroom is a fifth of its life — enough
 * to cover a slow renewal and clock skew between browser and Keycloak, without
 * renewing so eagerly that the refresh token rotates for no reason.
 */
export const RENEW_WHEN_SECONDS_LEFT = 60;

let userManager: UserManager | null = null;

const buildSettings = (): UserManagerSettings => {
  const basePath = (env.VITE_BASE_PATH ?? '').replace(/\/$/, '');
  const appOrigin = `${window.location.origin}${basePath}`;

  return {
    authority: env.VITE_KEYCLOAK_URL,
    client_id: env.VITE_KEYCLOAK_CLIENT_ID,
    redirect_uri: `${appOrigin}${AUTH_CALLBACK_PATH}`,
    post_logout_redirect_uri: appOrigin || `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid profile email',

    // Tokens survive a page reload but not a closed tab. localStorage would
    // leave them readable to any script on the origin for longer than the
    // session needs.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),

    // FSP renews on user activity and enforces its own inactivity timeout
    // (components/SessionTimeout); it deliberately runs no background poll, so
    // an idle user times out rather than being kept alive by a timer.
    automaticSilentRenew: false,

    // Everything FSP needs is on the access token — see the claim table in
    // backend/.../util/JwtPrincipalUtil.java. A /userinfo round-trip per
    // sign-in would buy nothing.
    loadUserInfo: false,
  };
};

/**
 * The shared {@link UserManager}, created on first use rather than at module
 * evaluation: `window.config` is injected by the container entrypoint and is not
 * guaranteed to be present when this module is first imported.
 */
export const getUserManager = (): UserManager => {
  if (!userManager) {
    userManager = new UserManager(buildSettings());
  }
  return userManager;
};

/**
 * Whether this token is expired, or close enough that it soon will be.
 *
 * oidc-client-ts derives `expired` from `expires_in`, so an explicit `false`
 * already means there is life left even when the remaining seconds are not to
 * hand. Only when neither says anything is renewing the safer guess.
 */
export const needsRenewal = (user: Pick<User, 'expired' | 'expires_in'>): boolean => {
  const secondsLeft = user.expires_in;
  if (secondsLeft === undefined) {
    return user.expired !== false;
  }
  return secondsLeft <= RENEW_WHEN_SECONDS_LEFT;
};

/**
 * The stored user, silently renewed if their access token has expired.
 *
 * Returns null when nobody is signed in rather than attempting a renewal.
 * `signinSilent` renews from the stored refresh token, but only when there is a
 * stored user to renew from; with nothing stored it falls back to a hidden-iframe
 * flow that can't succeed here (no `silent_redirect_uri`) and would hold the
 * Landing page behind a spinner for its 10-second timeout.
 */
export const loadStoredUser = async (
  manager: Pick<UserManager, 'getUser' | 'signinSilent'>,
): Promise<User | null> => {
  const user = await manager.getUser();
  if (!user) {
    return null;
  }
  if (!needsRenewal(user)) {
    return user;
  }
  return await manager.signinSilent();
};

/**
 * The stored user, renewed only if the access token is at or near expiry.
 *
 * Cheap to call often — a no-op until the token is nearly out — which is what
 * lets the idle guard run it on user activity. Somebody reading an FSP for five
 * quiet minutes makes no request, and without this would return to a dead token.
 */
export const ensureFreshUser = async (
  manager: Pick<UserManager, 'getUser' | 'signinSilent'>,
): Promise<User | null> => {
  const user = await manager.getUser();
  if (!user) {
    return null;
  }
  return needsRenewal(user) ? await manager.signinSilent() : user;
};

/**
 * Renews regardless of how much life the access token has left.
 *
 * For "Stay logged in", where the point is not the access token but the refresh
 * token behind it: using it rotates it, which is what actually moves the
 * thirty-minute ceiling and buys the extra time the button promises.
 */
export const forceRenew = async (
  manager: Pick<UserManager, 'signinSilent'>,
): Promise<User | null> => await manager.signinSilent();

/**
 * Siteminder's logoff endpoint for the realm in use: the production one for the
 * production realm, the test one for dev and test.
 */
export const siteminderLogoffUrl = (keycloakUrl: string): string => {
  let host = '';
  try {
    host = new URL(keycloakUrl).host;
  } catch {
    /* not a URL — treat as non-production */
  }
  return host === 'loginproxy.gov.bc.ca'
    ? 'https://logon7.gov.bc.ca/clp-cgi/logoff.cgi'
    : 'https://logontest7.gov.bc.ca/clp-cgi/logoff.cgi';
};

/**
 * Signs out of Siteminder, then Keycloak, then lands back on the app.
 *
 * **This is where FSP departs from nr-rept.** REPT signs in with IDIR - MFA
 * only, through Azure AD, so Keycloak's end-session is the whole logout. FSP
 * also signs in BCeID Business users, and BCeID goes through Siteminder, which
 * keeps its own session after Keycloak's ends: the next "Log in" would walk
 * straight back in without a password prompt. The SSO team's documented fix is
 * to chain the logout through Siteminder's logoff.cgi first
 * (sso-docs: best-practices/dos-donts.md, "SiteMinder — Chained Logout"). It's
 * run for every user, which is harmless for IDIR (`retnow=1` returns at once).
 *
 * The ID token is read off the stored user **before** the user is removed, so
 * Keycloak gets an `id_token_hint` it can tie to the session. Clearing first
 * would send a logout Keycloak can't attribute, leaving the realm session alive.
 *
 * Throws if the realm's metadata can't be loaded; callers fall back to clearing
 * this browser's tokens and going home.
 */
export const signOutEverywhere = async (): Promise<void> => {
  const manager = getUserManager();
  const settings = manager.settings;
  const endSession = await manager.metadataService.getEndSessionEndpoint();
  if (!endSession) {
    throw new Error('The realm publishes no end-session endpoint.');
  }

  const user = await manager.getUser();
  const keycloakLogout = new URL(endSession);
  keycloakLogout.searchParams.set('client_id', settings.client_id);
  if (settings.post_logout_redirect_uri) {
    keycloakLogout.searchParams.set('post_logout_redirect_uri', settings.post_logout_redirect_uri);
  }
  if (user?.id_token) {
    keycloakLogout.searchParams.set('id_token_hint', user.id_token);
  }

  await manager.removeUser();

  // One encodeURIComponent, so the Keycloak URL's own ?/& survive Siteminder's
  // query parsing instead of being read as Siteminder's parameters.
  window.location.assign(
    `${siteminderLogoffUrl(settings.authority)}?retnow=1&returl=${encodeURIComponent(
      keycloakLogout.toString(),
    )}`,
  );
};

/**
 * A usable access token for an API call, renewed first if near expiry.
 * Undefined when nobody is signed in or the renewal failed — the request then
 * goes out unauthorized and the 401 handling takes it from there.
 */
export const getFreshAccessToken = async (): Promise<string | undefined> => {
  try {
    const user = await ensureFreshUser(getUserManager());
    return user?.access_token;
  } catch {
    return undefined;
  }
};
