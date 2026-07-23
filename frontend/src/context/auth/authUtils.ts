import { env } from '@/env';

import {
  AVAILABLE_ROLES,
  validIdpProviders,
  type FamLoginUser,
  type IdpProviderType,
  type JWT,
  type ROLE_TYPE,
  type USER_PRIVILEGE_TYPE,
} from './types';

// ── Amplify localStorage token access ────────────────────────────────
// Amplify persists Cognito tokens in localStorage (its default store — the
// CookieStorage override was a no-op, see main.tsx). These helpers read the
// current token straight from that store WITHOUT calling fetchAuthSession —
// important because fetchAuthSession refreshes an expired token as a side
// effect (TokenOrchestrator.getTokens), which would silently slide the
// session-timeout deadline every time we polled it.

/** Base of the Amplify token keys for the configured app client. */
const tokenKeyBase = (): string =>
  `CognitoIdentityServiceProvider.${env.VITE_USER_POOLS_WEB_CLIENT_ID}`;

const readLocalStorage = (key: string): string | undefined => {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined; // storage disabled (e.g. hardened private mode)
  }
};

/**
 * The Cognito **access token** from Amplify's localStorage, or undefined.
 * This is the token sent to the backend API as a Bearer token. Note the API
 * layer reads its token via fetchAuthSession (storage-agnostic); this direct
 * reader backs only the auth-context convenience getters.
 */
export const getStoredAccessToken = (): string | undefined => {
  const base = tokenKeyBase();
  const user = readLocalStorage(`${base}.LastAuthUser`);
  if (!user) return undefined;
  return readLocalStorage(`${base}.${user}.accessToken`);
};

/**
 * Drops every Amplify token/session key for the configured app client from
 * localStorage. Used by the federated-logout path, which drives the sign-out
 * redirect chain itself (Siteminder → KC → Cognito → app) instead of Amplify's
 * signOut(): clearing the tokens here means that when the browser lands back
 * on the app at the end of the chain, AuthProvider bootstraps with no session
 * and renders the logged-out landing. The chain's final Cognito /logout hop
 * clears the Cognito session cookie server-side.
 */
export const clearStoredTokens = (): void => {
  try {
    const prefix = tokenKeyBase();
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage disabled — nothing to clear */
  }
};


// ── Token parsing ────────────────────────────────────────────────────

/**
 * Maps a possibly org-suffixed Cognito group (e.g. FSPTS_ADMINISTRATOR_DPG)
 * to its canonical role (FSPTS_ADMINISTRATOR). Mirrors the backend's
 * FsptsRoles.canonicalRoleFor.
 */
function canonicalRoleFor(group: string): ROLE_TYPE | undefined {
  for (const role of AVAILABLE_ROLES) {
    if (group === role || group.startsWith(`${role}_`)) return role;
  }
  return undefined;
}

/**
 * Role precedence, highest first — mirrors the backend
 * {@code FsptsRoles.PRECEDENCE}. The four internal roles outrank the two
 * client-tied roles.
 */
const ROLE_PRECEDENCE: ROLE_TYPE[] = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
  'FSPTS_SUBMITTER',
  'FSPTS_VIEW_ONLY',
];

/**
 * Collapses a user's granted roles to their single effective role (no
 * stacking). Internal roles win by precedence; since a user is never both
 * internal and client-tied, and client-tied users hold one role type, this
 * resolves to the right role. Per-client role scoping (the rare Submitter-on-A
 * / View-Only-on-B case) is enforced authoritatively on the backend via the
 * active-org client number. Returns undefined when no role is held.
 */
export function highestRole(roles: ROLE_TYPE[]): ROLE_TYPE | undefined {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role));
}

/**
 * Parses a Cognito ID token JWT into FSP's FamLoginUser shape. Extracts
 * display name, IDP provider, and rolls up Cognito groups into the
 * AVAILABLE_ROLES set.
 *
 * NOTE: Must be called with the **ID token**, not the access token —
 * only the ID token carries the `custom:idp_*` profile claims.
 */
export const parseToken = (idToken: JWT | undefined): FamLoginUser | undefined => {
  if (!idToken) return undefined;
  const decodedIdToken = idToken?.payload;
  const displayName = (decodedIdToken?.['custom:idp_display_name'] as string) || '';
  const idpProvider = validIdpProviders.includes(
    (decodedIdToken?.['custom:idp_name'] as string)?.toUpperCase() as IdpProviderType,
  )
    ? ((decodedIdToken?.['custom:idp_name'] as string).toUpperCase() as IdpProviderType)
    : undefined;
  const hasComma = displayName.includes(',');
  let [lastName, firstName] = hasComma ? displayName.split(', ') : displayName.split(' ');
  if (!hasComma) [lastName, firstName] = [firstName, lastName];
  const sanitizedFirstName = hasComma ? firstName?.split(' ')[0]?.trim() : firstName || '';
  const userName = (decodedIdToken?.['custom:idp_username'] as string) || '';
  const email = (decodedIdToken?.['email'] as string) || '';
  const cognitoGroups = extractGroups(decodedIdToken);
  const privileges = parsePrivileges(cognitoGroups);
  // No role stacking: collapse to the single highest effective role. The full
  // `privileges` map is kept (it's how client numbers are enumerated), but the
  // user's *capability* role list is exactly one entry.
  const derivedRoles = Object.keys(privileges) as ROLE_TYPE[];
  const effectiveRole = highestRole(derivedRoles);
  return {
    userName,
    displayName,
    email,
    idpProvider,
    privileges,
    roles: effectiveRole ? [effectiveRole] : [],
    firstName: sanitizedFirstName,
    lastName,
    providerUsername: idpProvider ? `${idpProvider}\\${userName}` : undefined,
  };
};

/**
 * Parses Cognito group strings into a user privilege object. Recognises
 * groups that match any AVAILABLE_ROLES root (with or without an org or
 * client-number suffix). For BCeID submitters the 8-digit client-number
 * suffix carries the scope — collected into the role's value array so
 * the multi-org picker can list them. Org-code suffixes (e.g. `_DCC`)
 * are still flattened to global since the backend handles org-unit
 * filtering for IDIR roles.
 */
export function parsePrivileges(input: string[]): USER_PRIVILEGE_TYPE {
  const result: USER_PRIVILEGE_TYPE = {};
  for (const item of input) {
    const canonical = canonicalRoleFor(item);
    if (!canonical) continue;
    const suffix = item.startsWith(`${canonical}_`)
      ? item.slice(canonical.length + 1)
      : '';
    // Only 8-digit numeric suffixes are client-number scopes worth
    // surfacing to the picker. Everything else (incl. blank for
    // root-only roles, org codes like DCC, etc.) flattens to global.
    const isClientNumber = /^\d{8}$/.test(suffix);
    if (isClientNumber) {
      const existing = result[canonical] ?? [];
      if (!existing.includes(suffix)) existing.push(suffix);
      result[canonical] = existing;
    } else if (!(canonical in result)) {
      result[canonical] = null;
    }
  }
  return result;
}

/**
 * Convenience: returns the list of forest-client numbers a BCeID user
 * is a Submitter for, sorted ascending. Empty list = not a multi-org
 * submitter (or not BCeID).
 */
export function listSubmitterClientNumbers(
  privileges: USER_PRIVILEGE_TYPE,
): string[] {
  const v = privileges.FSPTS_SUBMITTER;
  if (!Array.isArray(v)) return [];
  return [...v].sort();
}

/** Client-tied roles, highest-precedence first (Submitter wins a same-client tie). */
const CLIENT_ROLES: ROLE_TYPE[] = ['FSPTS_SUBMITTER', 'FSPTS_VIEW_ONLY'];

export interface ClientOrg {
  clientNumber: string;
  /** The client-tied role the user holds for this org (Submitter beats View Only). */
  role: ROLE_TYPE;
}

/**
 * Every forest-client org the user is party to through a client-tied role
 * (Submitter / View Only), each paired with the role they hold there, sorted
 * by client number. Drives the org picker (so a multi-client Submitter *or*
 * View-Only user is gated) and the per-org role labels on the selection page.
 */
export function listClientOrgs(privileges: USER_PRIVILEGE_TYPE): ClientOrg[] {
  const byClient = new Map<string, ROLE_TYPE>();
  for (const role of CLIENT_ROLES) {
    const clientNumbers = privileges[role];
    if (!Array.isArray(clientNumbers)) continue;
    for (const cn of clientNumbers) {
      if (!byClient.has(cn)) byClient.set(cn, role); // first match = highest role
    }
  }
  return [...byClient.entries()]
    .map(([clientNumber, role]) => ({ clientNumber, role }))
    .sort((a, b) => a.clientNumber.localeCompare(b.clientNumber));
}

/**
 * Extracts Cognito groups from a decoded JWT payload.
 */
export function extractGroups(decodedIdToken: object | undefined): string[] {
  if (!decodedIdToken) return [];
  if ('cognito:groups' in decodedIdToken) {
    return decodedIdToken['cognito:groups'] as string[];
  }
  return [];
}
