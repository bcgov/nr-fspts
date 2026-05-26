import { env } from '@/env';

import { ensureSessionFresh } from '@/context/auth/refreshSession';
import { getAccessTokenFromCookie } from '@/context/auth/authUtils';

const API_BASE_URL = env.VITE_API_BASE_URL ?? '';

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

  const token = getAccessTokenFromCookie();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const url = /^https?:/.test(path) ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}
