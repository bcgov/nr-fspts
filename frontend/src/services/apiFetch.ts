import { fetchAuthSession } from 'aws-amplify/auth';

import { env } from '@/env';

import { ensureSessionFresh } from '@/context/auth/refreshSession';
import { getActiveOrgClientNumber } from '@/context/org/useOrg';

/**
 * Header sent on every authenticated request when a BCeID submitter
 * has picked an active org. Backend RequestUtil reads this and
 * validates it against the JWT's groups before scoping queries.
 */
const ACTIVE_ORG_HEADER = 'X-FSPTS-Active-Org-Client-Number';

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
  // Forward the BCeID submitter's active-org choice. Reads
  // sessionStorage directly (no React context dependency), so this
  // works from any caller — including non-React service modules.
  const activeOrg = getActiveOrgClientNumber();
  if (activeOrg && !headers.has(ACTIVE_ORG_HEADER)) {
    headers.set(ACTIVE_ORG_HEADER, activeOrg);
  }

  const url = /^https?:/.test(path) ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}

/**
 * Pulls the user-facing message out of an error response body. Handles
 * both shapes the backend emits:
 * <ul>
 *   <li>Spring's RFC7807 {@code ProblemDetail} —
 *       {@code {type, title, status, detail, instance}} — where the
 *       human-readable text is in {@code detail} (falling back to
 *       {@code title}).</li>
 *   <li>The legacy {@code RestExceptionHandler} shape —
 *       {@code {status, timestamp, message, ...}}.</li>
 * </ul>
 * We try {@code detail}, then {@code message}, then {@code title} so the
 * toast subtitle gets a clean sentence rather than the raw JSON. Falls
 * back to the raw text for non-JSON bodies (e.g. a plain 502 from a
 * proxy or an unhandled exception that surfaces as text).
 */
export async function readErrorMessage(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const fields = parsed as Record<string, unknown>;
      for (const key of ['detail', 'message', 'title'] as const) {
        const val = fields[key];
        if (typeof val === 'string' && val.trim()) return val.trim();
      }
    }
  } catch {
    // Body wasn't JSON — fall through and surface the raw text.
  }
  return raw;
}
