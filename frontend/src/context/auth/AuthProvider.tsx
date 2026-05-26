import { fetchAuthSession, signInWithRedirect, signOut } from 'aws-amplify/auth';
import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';

import { env } from '@/env';

import { AuthContext, type AuthContextType } from './AuthContext';
import { parseToken, getAccessTokenFromCookie } from './authUtils';
import type { FamLoginUser, LoginProvider } from './types';

/**
 * Seconds before access-token expiry at which we consider it "stale" and
 * force a refresh on the next API call. Keeps a small buffer so the
 * token is still valid by the time the request reaches the server.
 */
const REFRESH_MARGIN_SECONDS = 30;

/**
 * Minimum gap (ms) between two consecutive refresh attempts. Prevents
 * multiple near-simultaneous API calls from each triggering their own
 * refresh.
 */
const MIN_REFRESH_GAP_MS = 5_000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FamLoginUser | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // VITE_ZONE drives the Cognito identity_provider prefix (e.g. DEV-IDIR,
  // TEST-IDIR, IDIR). Numeric zones (PR previews) fall back to TEST so
  // we don't try to call a non-existent <PR>-IDIR provider.
  const appEnv = isNaN(Number(env.VITE_ZONE)) ? (env.VITE_ZONE ?? 'TEST') : 'TEST';

  // Track whether a refresh is already in flight to avoid concurrent calls.
  const refreshInFlight = useRef(false);
  const lastRefreshTime = useRef(0);

  // ── Core session loader ────────────────────────────────────────────
  const loadSession = useCallback(
    async (forceRefresh = false): Promise<FamLoginUser | undefined> => {
      const { tokens } = (await fetchAuthSession({ forceRefresh })) ?? {};
      const idToken = tokens?.idToken;
      if (!idToken) return undefined;
      return parseToken(idToken);
    },
    [],
  );

  // ── Initial session bootstrap ──────────────────────────────────────
  // Users without any recognised FSPTS role are kept in state
  // (isLoggedIn=true) so the routing layer can route them to a "no
  // access" page rather than bouncing them back through Cognito.
  const refreshUserState = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsed = await loadSession(false);
      setUser(parsed);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[AuthProvider] error loading user:', error);
      setUser(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [loadSession]);

  // Bootstrap on mount. Runs once per page load; if the URL contains a
  // ?code=&state= pair, Amplify.configure() (in main.tsx) has already
  // exchanged it for tokens stored in CookieStorage by the time we get
  // here, so fetchAuthSession() just reads them.
  useEffect(() => {
    refreshUserState();
  }, [refreshUserState]);

  // ── On-demand token refresh ────────────────────────────────────────
  // Called before each API request from the service layer. Checks the
  // access token's `exp` claim; if it's about to expire, forces a
  // refresh via the refresh token. If the refresh token has also
  // expired, signs the user out.
  //
  // No background interval — the token is only refreshed when the user
  // makes an API call, so idle users naturally time out once their
  // refresh token expires.
  const ensureFreshToken = useCallback(async (): Promise<string | undefined> => {
    try {
      const { tokens } = (await fetchAuthSession({ forceRefresh: false })) ?? {};
      const accessToken = tokens?.accessToken;

      if (!accessToken) {
        await signOut();
        setUser(undefined);
        return undefined;
      }

      const exp = accessToken.payload?.exp;
      if (!exp) {
        return accessToken.toString();
      }

      const secondsRemaining = exp - Math.floor(Date.now() / 1000);

      if (secondsRemaining > REFRESH_MARGIN_SECONDS) {
        return accessToken.toString();
      }

      if (refreshInFlight.current) {
        // Another refresh is already happening; wait a beat and read
        // from cookie so we don't race.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return getAccessTokenFromCookie();
      }

      const now = Date.now();
      if (now - lastRefreshTime.current < MIN_REFRESH_GAP_MS) {
        return getAccessTokenFromCookie();
      }

      refreshInFlight.current = true;
      lastRefreshTime.current = now;

      try {
        const parsed = await loadSession(true);
        if (parsed) setUser(parsed);
        return getAccessTokenFromCookie();
      } finally {
        refreshInFlight.current = false;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[AuthProvider] Session expired — signing out.', error);
      refreshInFlight.current = false;
      await signOut();
      setUser(undefined);
      return undefined;
    }
  }, [loadSession]);

  // ── Auth actions ───────────────────────────────────────────────────

  const login = useCallback(
    async (provider: LoginProvider) => {
      // Cognito identity_provider names follow the pattern
      // `<ENV>-<PROVIDER>` (e.g. DEV-IDIR, TEST-BCEIDBUSINESS). The
      // env prefix is omitted in PROD.
      const prefix = appEnv === 'PROD' ? '' : `${appEnv.toUpperCase()}-`;
      const providerName = provider === 'idir' ? `${prefix}IDIR` : `${prefix}BCEIDBUSINESS`;
      signInWithRedirect({ provider: { custom: providerName } });
    },
    [appEnv],
  );

  const logout = useCallback(async () => {
    await signOut();
    setUser(undefined);
  }, []);

  const userToken = useCallback((): string | undefined => {
    return getAccessTokenFromCookie();
  }, []);

  const contextValue: AuthContextType = useMemo(
    () => ({
      user,
      isLoggedIn: !!user,
      isLoading,
      login,
      logout,
      userToken,
      ensureFreshToken,
    }),
    [user, isLoading, login, logout, userToken, ensureFreshToken],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};
