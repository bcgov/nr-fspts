import { fetchAuthSession } from 'aws-amplify/auth';

import { env } from '@/env';

import { ensureSessionFresh } from '@/context/auth/refreshSession';
import { getActiveOrgClientNumber } from '@/context/org/useOrg';
import { safeErrorMessage } from '@/lib/errorMessage';

/**
 * Header sent on every authenticated request when a BCeID submitter
 * has picked an active org. Backend RequestUtil reads this and
 * validates it against the JWT's groups before scoping queries.
 */
const ACTIVE_ORG_HEADER = 'X-FSPTS-Active-Org-Client-Number';

const API_BASE_URL = env.VITE_API_BASE_URL ?? '';

/**
 * Reads the current Cognito access token via Amplify's auth session.
 * Mirrors nr-rept's services/http/headers.ts pattern: parse the token from
 * Amplify's session rather than reading storage keys directly. Amplify keeps
 * tokens in localStorage (its default store — see main.tsx), and going through
 * fetchAuthSession also transparently refreshes a near-expired token, so this
 * both survives storage changes and keeps the bearer fresh.
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
  let candidate = '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const fields = parsed as Record<string, unknown>;
      for (const key of ['detail', 'message', 'title'] as const) {
        const val = fields[key];
        if (typeof val === 'string' && val.trim()) {
          candidate = val.trim();
          break;
        }
      }
      // A JSON body with no message field (e.g. Spring's default
      // {timestamp,status,error,path}) has nothing human-readable —
      // leave `candidate` empty so the caller uses its own fallback.
    } else if (typeof parsed === 'string') {
      candidate = parsed;
    }
  } catch {
    // Body wasn't JSON — the raw text is the only candidate.
    candidate = raw;
  }
  // Guard the choke point: never hand a caller raw SQL/ORA/stack-trace or
  // an error-JSON dump. Technical text collapses to '' so the caller's
  // clean fallback message wins.
  return safeErrorMessage(candidate, '');
}
