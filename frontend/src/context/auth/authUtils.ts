import {
  AVAILABLE_ROLES,
  type FamLoginUser,
  type IdpProviderType,
  type ROLE_TYPE,
  type USER_PRIVILEGE_TYPE,
} from './types';

/**
 * The claims FSP reads off a BC Gov SSO access token.
 *
 * Names follow the SSO identity-mappers reference for the *IDIR - MFA* and
 * *BCeID Business* integrations:
 * https://bcgov.github.io/sso-docs/advanced/identity-mappers
 *
 * All of these ride the access token (a CSS console setting per environment).
 */
export type KeycloakProfile = {
  /** `<guid>@azureidir` / `<guid>@bceidbusiness`. Stable per user per provider. */
  preferred_username?: string;
  idir_username?: string;
  idir_user_guid?: string;
  bceid_username?: string;
  bceid_user_guid?: string;
  bceid_business_name?: string;
  /** `azureidir` for IDIR - MFA, `bceidbusiness` for BCeID Business. */
  identity_provider?: string;
  display_name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  name?: string;
  /** Roles CSS attaches for the client the token was issued to. */
  client_roles?: string[];
  resource_access?: Record<string, { roles?: string[] }>;
  azp?: string;
  [claim: string]: unknown;
};

/**
 * FAM's own bookkeeping roles, which reach the token like any other role —
 * e.g. `FAM:EXPIRES:2026-09-30:FSPTS_SUBMITTER_FOREST_CLIENT-00012345`. They
 * must never be read as privileges.
 */
const FAM_SIDECAR_PREFIX = 'FAM:';

/**
 * Normalises the realm's provider alias to the name FSP uses.
 *
 * IDIR - MFA reports `azureidir`; the legacy alias is `idir`. BCeID Business
 * reports `bceidbusiness`. Falls back to the `preferred_username` suffix, which
 * is always present. Anything else is left undefined rather than guessed at.
 */
export const parseIdpProvider = (profile: KeycloakProfile): IdpProviderType | undefined => {
  const raw = (
    profile.identity_provider ??
    profile.preferred_username?.split('@')[1] ??
    ''
  ).toLowerCase();
  if (raw === 'azureidir' || raw === 'idir') return 'IDIR';
  if (raw === 'bceidbusiness' || raw === 'bceidboth') return 'BCEIDBUSINESS';
  return undefined;
};

/**
 * The caller's roles for the client the token was issued to, minus FAM's
 * `FAM:` sidecars.
 *
 * Under CSS these arrive as `client_roles`. Falls back to
 * `resource_access.<azp>.roles`, which is where stock Keycloak puts them —
 * which one appears depends on the realm's mappers, so both are read.
 */
export const extractRoles = (profile: KeycloakProfile | undefined): string[] => {
  if (!profile) return [];
  let roles: string[] = [];
  if (Array.isArray(profile.client_roles) && profile.client_roles.length > 0) {
    roles = profile.client_roles;
  } else if (profile.azp) {
    const fromResourceAccess = profile.resource_access?.[profile.azp]?.roles;
    roles = Array.isArray(fromResourceAccess) ? fromResourceAccess : [];
  }
  return roles.filter((role) => typeof role === 'string' && !role.startsWith(FAM_SIDECAR_PREFIX));
};

/** Scope types FAM appends to a role name, longest first. */
const SCOPE_TYPES = ['FOREST_CLIENT', 'DISTRICT', 'REGION'] as const;

/**
 * Splits a FAM role name into its base role and scopes — FAM's own grammar
 * (`CssRoleNaming.parse` in nr-fam), mirrored by the backend's FamRoles.parse:
 *
 *   FSPTS_SUBMITTER_FOREST_CLIENT-00012345 → FSPTS_SUBMITTER, {FOREST_CLIENT: 00012345}
 *   FSPTS_VIEW_ALL_REGION-KOOTENAY_BOUNDARY → FSPTS_VIEW_ALL, {REGION: KOOTENAY_BOUNDARY}
 *
 * Peels suffixes from the right: the value is everything after the last `-`,
 * and what precedes it must end in a known `_<SCOPE_TYPE>`. Never splits on
 * underscores — `FOREST_CLIENT` and region values contain them.
 */
export function parseFamRole(roleName: string): { base: string; scopes: Record<string, string> } {
  const scopes: Record<string, string> = {};
  let remaining = roleName;
  for (;;) {
    const hyphen = remaining.lastIndexOf('-');
    if (hyphen < 0) break;
    const head = remaining.slice(0, hyphen);
    const value = remaining.slice(hyphen + 1);
    const type = SCOPE_TYPES.find(
      (t) => head.endsWith(`_${t}`) && head.length > t.length + 1,
    );
    if (!type) break;
    scopes[type] = value;
    remaining = head.slice(0, head.length - type.length - 1);
  }
  return { base: remaining, scopes };
}

// ── Token parsing ────────────────────────────────────────────────────

/**
 * Maps a FAM role (e.g. FSPTS_SUBMITTER_FOREST_CLIENT-00012345, or an
 * organization-named FSPTS_ADMINISTRATOR_DPG) to its canonical role. Mirrors
 * the backend's FsptsRoles.canonicalRoleFor.
 */
function canonicalRoleFor(roleName: string): ROLE_TYPE | undefined {
  const { base } = parseFamRole(roleName);
  for (const role of AVAILABLE_ROLES) {
    if (base === role || base.startsWith(`${role}_`)) return role;
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
 * Parses an oidc-client-ts profile (the access-token claims) into FSP's
 * FamLoginUser shape: display name, provider, and the FSPTS roles rolled up
 * into AVAILABLE_ROLES.
 *
 * `given_name` / `family_name` are real claims on this realm, so the name is
 * read directly rather than split out of the display name as it was for
 * Cognito's `custom:idp_display_name`.
 */
export const parseToken = (profile: KeycloakProfile | undefined): FamLoginUser | undefined => {
  if (!profile) return undefined;
  const idpProvider = parseIdpProvider(profile);
  const userName = profile.idir_username ?? profile.bceid_username ?? '';
  const firstName = profile.given_name ?? '';
  const lastName = profile.family_name ?? '';
  const displayName =
    profile.display_name ?? profile.name ?? [firstName, lastName].filter(Boolean).join(' ');
  const privileges = parsePrivileges(extractRoles(profile));
  // No role stacking: collapse to the single highest effective role. The full
  // `privileges` map is kept (it's how client numbers are enumerated), but the
  // user's *capability* role list is exactly one entry.
  const derivedRoles = Object.keys(privileges) as ROLE_TYPE[];
  const effectiveRole = highestRole(derivedRoles);
  return {
    userName,
    displayName,
    email: profile.email ?? '',
    idpProvider,
    privileges,
    roles: effectiveRole ? [effectiveRole] : [],
    firstName,
    lastName,
    providerUsername: idpProvider ? `${idpProvider}\\${userName}` : undefined,
  };
};

/**
 * Parses FAM role names into a user privilege object. Recognises roles whose
 * base matches any AVAILABLE_ROLES root. For client-tied roles the
 * FOREST_CLIENT scope (an 8-digit client number) is collected into the
 * role's value array so the multi-org picker can list them. Other scopes
 * (district, region) flatten to global, since the backend handles org-unit
 * filtering for IDIR roles. FAM: sidecars must already be filtered out
 * (extractRoles does that).
 */
export function parsePrivileges(input: string[]): USER_PRIVILEGE_TYPE {
  const result: USER_PRIVILEGE_TYPE = {};
  for (const item of input) {
    if (item.startsWith(FAM_SIDECAR_PREFIX)) continue;
    const canonical = canonicalRoleFor(item);
    if (!canonical) continue;
    const client = parseFamRole(item).scopes.FOREST_CLIENT;
    if (client && /^\d{8}$/.test(client)) {
      const existing = result[canonical] ?? [];
      if (!existing.includes(client)) existing.push(client);
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
