import type { JWT as AmplifyJWT } from '@aws-amplify/core';

export type JWT = AmplifyJWT;

/**
 * Recognized Cognito groups that map to FSP application roles. Mirrors the
 * backend's ca.bc.gov.nrs.fsp.api.security.FsptsRoles enum — keep these two
 * lists in sync. Org-suffixed Cognito groups (e.g. FSPTS_ADMINISTRATOR_DPG)
 * canonicalise to their root role; see authUtils.canonicalRoleFor.
 */
export const AVAILABLE_ROLES = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
  'FSPTS_SUBMITTER',
  'FSPTS_VIEW_ONLY',
] as const;

export type ROLE_TYPE = (typeof AVAILABLE_ROLES)[number];

type RoleValue = string[] | null;

export type USER_PRIVILEGE_TYPE = Partial<Record<ROLE_TYPE, RoleValue>>;

// FSP supports both IDIR (ministry/government staff) and BCeID Business
// (industry licensees / agreement holders). REPT only does IDIR.
export const validIdpProviders = ['IDIR', 'BCEIDBUSINESS'] as const;

export type IdpProviderType = (typeof validIdpProviders)[number];

/**
 * Provider identifier passed to AuthProvider.login() — translated into the
 * Cognito custom identity_provider name (e.g. 'idir' → 'DEV-IDIR' in dev).
 */
export type LoginProvider = 'idir' | 'bceid';

export type FamLoginUser = {
  providerUsername?: string;
  userName?: string;
  displayName?: string;
  email?: string;
  idpProvider?: IdpProviderType;
  roles?: ROLE_TYPE[];
  authToken?: string;
  exp?: number;
  privileges: USER_PRIVILEGE_TYPE;
  firstName?: string;
  lastName?: string;
};
