import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';

import {
  KC_IDP_HINTS,
  ensureFreshUser,
  forceRenew,
  getUserManager,
  loadStoredUser,
  signOutEverywhere,
} from '@/services/keycloak';

import { AuthContext, type AuthContextType } from './AuthContext';
import { parseToken, type KeycloakProfile } from './authUtils';
import type { FamLoginUser, LoginProvider } from './types';

/**
 * BC Gov SSO (Keycloak) session for the SPA, via oidc-client-ts. Ported from
 * nr-rept; FSP adds the IDIR / BCeID Business choice at sign-in.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FamLoginUser | undefined>(undefined);
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // Guards against two near-simultaneous callers each starting their own
  // renewal. A ref, because changing it must not re-render.
  const renewInFlight = useRef<Promise<string | undefined> | null>(null);

  /** Publishes a signed-in session, or clears it when the user is gone. */
  const applyUser = useCallback(
    (oidcUser: { access_token?: string; profile?: unknown } | null) => {
      if (!oidcUser?.access_token) {
        setUser(undefined);
        setAccessToken(undefined);
        return undefined;
      }
      setAccessToken(oidcUser.access_token);
      setUser(parseToken(oidcUser.profile as KeycloakProfile));
      return oidcUser.access_token;
    },
    [],
  );

  // ── Initial session bootstrap ──────────────────────────────────────
  // Users without any recognised FSPTS role are kept in state
  // (isLoggedIn=true) so the routing layer can route them to the "no
  // access" page rather than bouncing them back through Keycloak.
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const restored = await loadStoredUser(getUserManager());
        if (!cancelled) applyUser(restored);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[AuthProvider] error loading user:', error);
        if (!cancelled) applyUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  // ── Auth actions ───────────────────────────────────────────────────

  const login = useCallback((provider: LoginProvider) => {
    void getUserManager().signinRedirect({
      extraQueryParams: { kc_idp_hint: KC_IDP_HINTS[provider] },
    });
  }, []);

  /**
   * Ends the Siteminder and Keycloak sessions (see signOutEverywhere for why
   * FSP chains through Siteminder where nr-rept doesn't).
   *
   * **The stored user is read before it is removed** so Keycloak gets an
   * `id_token_hint`; clearing the tokens first sends a logout Keycloak can't
   * attribute to a session, so the realm session survives and the next sign-in
   * walks straight back in without a prompt.
   *
   * React state is not cleared before the redirect: that would briefly mount
   * the Landing page, whose mount effect reads-and-clears the session-expired
   * flag before the round trip returns, so the timeout notice would never show.
   *
   * **And it always finishes.** Callers invoke this as `void logout()`, so a
   * redirect that throws would otherwise reject into nothing and leave a
   * signed-out page over a live realm session. The catch drops this browser's
   * tokens and goes to the sign-in screen instead.
   */
  const logout = useCallback(async () => {
    try {
      await signOutEverywhere();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[AuthProvider] sign-out redirect failed; clearing locally.', error);
      await getUserManager()
        .removeUser()
        .catch(() => undefined);
      applyUser(null);
      window.location.assign(import.meta.env.BASE_URL || '/');
    }
  }, [applyUser]);

  const userToken = useCallback((): string | undefined => accessToken, [accessToken]);

  /**
   * Returns a usable access token, renewing first if it is at or near expiry.
   *
   * Called, throttled, on user activity by the idle guard. A no-op unless the
   * token is nearly out, so it is cheap to call often.
   *
   * Concurrent callers share one renewal rather than each starting their own:
   * every `signinSilent` rotates the refresh token, and racing rotations is how
   * a session dies while somebody is using it.
   */
  const ensureFreshToken = useCallback(async (): Promise<string | undefined> => {
    if (renewInFlight.current) {
      return renewInFlight.current;
    }

    const attempt = (async () => {
      try {
        const fresh = await ensureFreshUser(getUserManager());
        return applyUser(fresh);
      } catch (error) {
        // The refresh token is gone or was refused — the session is over.
        // eslint-disable-next-line no-console
        console.warn('[AuthProvider] Session expired — signing out.', error);
        void logout();
        return undefined;
      } finally {
        renewInFlight.current = null;
      }
    })();

    renewInFlight.current = attempt;
    return attempt;
  }, [applyUser, logout]);

  /**
   * Unconditional renewal, backing the timeout dialog's "Stay logged in".
   *
   * Renews however much life the access token has left, because the point is
   * the refresh token behind it: using it rotates it, which is what moves the
   * thirty-minute ceiling. Throws when the refresh token has already expired —
   * the caller then treats it as a real expiry.
   */
  const forceRefreshSession = useCallback(async (): Promise<void> => {
    const renewed = await forceRenew(getUserManager());
    applyUser(renewed);
  }, [applyUser]);

  /** Completes the redirect back from Keycloak. Used only by AuthCallback. */
  const completeLogin = useCallback(async (): Promise<void> => {
    const signedIn = await getUserManager().signinRedirectCallback();
    applyUser(signedIn);
  }, [applyUser]);

  const contextValue: AuthContextType = useMemo(
    () => ({
      user,
      isLoggedIn: !!user,
      isLoading,
      login,
      logout,
      userToken,
      ensureFreshToken,
      forceRefreshSession,
      completeLogin,
    }),
    [
      user,
      isLoading,
      login,
      logout,
      userToken,
      ensureFreshToken,
      forceRefreshSession,
      completeLogin,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};
