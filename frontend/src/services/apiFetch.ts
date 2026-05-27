import { fetchAuthSession } from 'aws-amplify/auth';

import { env } from '@/env';

import { ensureSessionFresh } from '@/context/auth/refreshSession';

const API_BASE_URL = env.VITE_API_BASE_URL ?? '';

/**
 * Reads the current Cognito access token via Amplify's auth session.
 * Mirrors nr-rept's services/http/headers.ts pattern: parse the token
 * from Amplify rather than from document.cookie. The configured
 * CookieStorage doesn't always write tokens as DOM-visible cookies
 * depending on Amplify's internal flow (httpOnly, secure-only, or an
 * in-memory fallback), so document.cookie-based reads silently return
 * nothing in deployed environments — producing 401s on every API call.
 */
const getAccessToken = async (): Promise<string | undefined> => {
  try {
    const { tokens } = (await fetchAuthSession()) ?? {};
    return tokens?.accessToken?.toString();
  } catch {
    return undefined;
  }
};

/**
 * Fetch wrapper that refreshes the Cognito session if its access token
 * is near expiry, attaches the current access token as a Bearer header,
 * and prefixes paths with the configured API base URL.
 *
 * Pair every service-layer call (services/fspSearch.ts, etc.) with this
 * helper rather than calling fetch() directly — the ensureSessionFresh
 * pre-check is what lets idle tabs survive past the 5-minute access
 * token TTL.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await ensureSessionFresh();

  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const url = /^https?:/.test(path) ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}
