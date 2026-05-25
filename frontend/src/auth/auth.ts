import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

const AUTH_AUTHORITY            = import.meta.env.VITE_AUTH_AUTHORITY;
const AUTH_ISSUER               = import.meta.env.VITE_AUTH_ISSUER;
const AUTH_CLIENT_ID            = import.meta.env.VITE_AUTH_CLIENT_ID;
const AUTH_REDIRECT_URI         = import.meta.env.VITE_AUTH_REDIRECT_URI;
const AUTH_LOGOUT_REDIRECT_URI  = import.meta.env.VITE_AUTH_LOGOUT_REDIRECT_URI;
const AUTH_SCOPES               = import.meta.env.VITE_AUTH_SCOPES ?? 'openid profile email';
const API_BASE_URL              = import.meta.env.VITE_API_BASE_URL ?? '';

const SESSION_KEY  = 'auth.session';
const STATE_KEY    = 'auth.state';
const VERIFIER_KEY = 'auth.codeVerifier';

// Refresh the access token if it expires within this window. Cognito access
// tokens here have a 5-minute TTL; this gives us a small safety margin.
const REFRESH_THRESHOLD_MS = 30_000;

// Cognito signs ID tokens with RS256; pin the algorithm to block alg-substitution attacks.
const ID_TOKEN_ALGORITHMS = ['RS256'];
const jwks = AUTH_ISSUER
  ? createRemoteJWKSet(new URL(`${AUTH_ISSUER}/.well-known/jwks.json`))
  : null;

// ── Types ──────────────────────────────────────────────────
export interface CognitoTokens {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface User {
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  roles: string[];
  claims: JWTPayload;
}

// Canonical FSPTS roles. Mirrors backend ca.bc.gov.nrs.fsp.api.security.FsptsRoles
// — keep these two lists in sync.
export const FSPTS_ROLES = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
  'FSPTS_SUBMITTER',
  'FSPTS_VIEW_ONLY',
] as const;
export type FsptsRole = (typeof FSPTS_ROLES)[number];

// Maps a Cognito group (possibly with org suffix like FSPTS_ADMINISTRATOR_DPG)
// to its canonical role, mirroring FsptsRoles.canonicalRoleFor in Java.
function canonicalRoleFor(group: string): FsptsRole | null {
  for (const role of FSPTS_ROLES) {
    if (group === role || group.startsWith(`${role}_`)) return role;
  }
  return null;
}

function extractRoles(claims: JWTPayload): FsptsRole[] {
  const raw = claims['cognito:groups'];
  const groups = Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];
  const set = new Set<FsptsRole>();
  for (const g of groups) {
    const canonical = canonicalRoleFor(g);
    if (canonical) set.add(canonical);
  }
  return Array.from(set);
}

export interface Session {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  user: User;
}

type Listener = () => void;

interface TokenRequestError extends Error {
  status?: number;
}

// ── Session store with pub-sub ─────────────────────────────
// The session lives in this module-level variable (in-memory cache) and is
// mirrored to sessionStorage so a page reload within the same tab survives.
// Tab close clears the session; localStorage was deliberately not used.
let session: Session | null = loadFromStorage();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch (e) { console.error('auth listener threw', e); }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSession(): Session | null {
  return session;
}

function setSession(next: Session | null): void {
  session = next;
  if (next) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
  notify();
}

function loadFromStorage(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

// ── PKCE helpers ───────────────────────────────────────────
function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(hash));
}

// ── ID token verification ──────────────────────────────────
async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  if (!jwks) {
    throw new Error('VITE_AUTH_ISSUER is not configured — cannot verify ID token signature.');
  }
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: AUTH_ISSUER,
    audience: AUTH_CLIENT_ID,
    algorithms: ID_TOKEN_ALGORITHMS,
  });
  return payload;
}

function extractUser(claims: JWTPayload): User {
  const givenName = typeof claims.given_name === 'string' ? claims.given_name : '';
  const familyName = typeof claims.family_name === 'string' ? claims.family_name : '';
  const fullName = [givenName, familyName].filter(Boolean).join(' ').trim();
  const displayName = claims['custom:idp_display_name'];
  const cognitoUsername = claims['cognito:username'];

  const name = (typeof displayName === 'string' && displayName)
    || (typeof claims.name === 'string' && claims.name)
    || fullName
    || (typeof cognitoUsername === 'string' && cognitoUsername)
    || 'User';

  return {
    name,
    firstName: givenName || undefined,
    lastName: familyName || undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    username: typeof cognitoUsername === 'string' ? cognitoUsername : undefined,
    roles: extractRoles(claims),
    claims,
  };
}

async function buildSession(tokens: CognitoTokens, fallbackRefreshToken?: string | null): Promise<Session> {
  const claims = await verifyIdToken(tokens.id_token);
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    // The refresh endpoint does not return a new refresh_token unless rotation
    // is enabled on the user pool client; preserve the existing one in that case.
    refreshToken: tokens.refresh_token ?? fallbackRefreshToken ?? null,
    expiresAt: Date.now() + (tokens.expires_in ?? 300) * 1000,
    user: extractUser(claims),
  };
}

// ── Token endpoint ─────────────────────────────────────────
async function tokenRequest(params: Record<string, string>): Promise<CognitoTokens> {
  const res = await fetch(`${AUTH_AUTHORITY}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err: TokenRequestError = new Error(`Token request failed: ${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<CognitoTokens>;
}

// ── Login flow ─────────────────────────────────────────────
export async function startLogin(identityProvider: string): Promise<void> {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH_CLIENT_ID,
    redirect_uri: AUTH_REDIRECT_URI,
    scope: AUTH_SCOPES,
    identity_provider: identityProvider,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${AUTH_AUTHORITY}/oauth2/authorize?${params.toString()}`);
}

export interface CompleteLoginInput {
  code: string;
  returnedState: string | null;
}

export async function completeLogin({ code, returnedState }: CompleteLoginInput): Promise<Session> {
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const codeVerifier  = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!expectedState || expectedState !== returnedState) {
    throw new Error('State mismatch — possible CSRF or stale callback URL.');
  }
  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier — sign-in must be started from this tab.');
  }

  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: AUTH_CLIENT_ID,
    code,
    redirect_uri: AUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  const next = await buildSession(tokens);
  setSession(next);
  return next;
}

// ── Refresh (single-flight) ────────────────────────────────
let pendingRefresh: Promise<Session> | null = null;

async function refreshTokens(): Promise<Session> {
  if (pendingRefresh) return pendingRefresh;
  if (!session?.refreshToken) {
    throw new Error('No refresh token available.');
  }
  const refreshToken = session.refreshToken;
  pendingRefresh = (async () => {
    try {
      const tokens = await tokenRequest({
        grant_type: 'refresh_token',
        client_id: AUTH_CLIENT_ID,
        refresh_token: refreshToken,
      });
      const next = await buildSession(tokens, refreshToken);
      setSession(next);
      return next;
    } catch (e) {
      // 4xx means the refresh token is dead — clear the session so the UI
      // falls back to the login screen. Network/5xx errors propagate without
      // clearing so transient failures don't log the user out.
      const status = (e as TokenRequestError).status;
      if (status && status >= 400 && status < 500) {
        setSession(null);
      }
      throw e;
    } finally {
      pendingRefresh = null;
    }
  })();
  return pendingRefresh;
}

// ── Public token + API helpers ─────────────────────────────
export async function getAccessToken(): Promise<string | null> {
  if (!session) return null;
  if (Date.now() >= (session.expiresAt ?? 0) - REFRESH_THRESHOLD_MS) {
    await refreshTokens();
  }
  return session?.accessToken ?? null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const url = /^https?:/.test(path) ? path : `${API_BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers });

  // The backend rejected our token even after a fresh refresh — drop the
  // session and let the UI redirect to login.
  if (res.status === 401) {
    setSession(null);
  }
  return res;
}

export function logout(): void {
  setSession(null);
  if (AUTH_AUTHORITY && AUTH_LOGOUT_REDIRECT_URI) {
    const params = new URLSearchParams({
      client_id: AUTH_CLIENT_ID,
      logout_uri: AUTH_LOGOUT_REDIRECT_URI,
    });
    window.location.assign(`${AUTH_AUTHORITY}/logout?${params.toString()}`);
  }
}
