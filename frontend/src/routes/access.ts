import type { FamLoginUser, ROLE_TYPE } from '@/context/auth/types';

/**
 * Roles that grant broader access than the Submitter floor. Holders
 * see the full IDIR-style nav (Search / Inbox / Reports / etc.); their
 * Submitter role, if any, doesn't restrict them.
 *
 * <p>Driven by FSPTS role assignments only — the user's IDP (IDIR vs
 * BCeID) is intentionally NOT part of the decision. IDIR users can be
 * Submitters; BCeID users can theoretically be granted any role. The
 * boundary is the role grant, not the login provider.
 */
const PRIVILEGED_ROLES: ROLE_TYPE[] = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
  'FSPTS_VIEW_ONLY',
];

/**
 * @return true when the user's only FSPTS role is {@code FSPTS_SUBMITTER}
 *     (or none of the recognised roles, which collapses to the same
 *     restricted experience). Holding ANY {@link PRIVILEGED_ROLES}
 *     short-circuits to false so an IDIR admin who also happens to
 *     hold the Submitter role keeps full access.
 */
export function isSubmitterOnly(user: FamLoginUser | null | undefined): boolean {
  const roles = user?.roles ?? [];
  if (roles.some((r) => PRIVILEGED_ROLES.includes(r))) return false;
  return true;
}

/**
 * @return true when the user has any submitter privilege at all (alone
 *     or alongside a privileged role). Drives nav-menu visibility for
 *     entries like Submission History that only make sense when the
 *     user can act on behalf of a forest-client org.
 */
export function hasSubmitterRole(
  user: FamLoginUser | null | undefined,
): boolean {
  return (user?.roles ?? []).includes('FSPTS_SUBMITTER');
}

/**
 * Path prefixes a submitter-only user is allowed to load directly.
 * Anything not on this list collapses to {@link ForbiddenPage} via the
 * route guard in App.tsx. Matched by exact path OR `path + "/"` prefix
 * so a future `/data-submission/foo` sub-path stays inside the gate
 * without extra entries.
 */
const SUBMITTER_ALLOWED_PATHS = [
  '/auth/callback',
  '/org-select',
  '/data-submission',
  '/submission-history',
  '/fsp/information',
  '/fsp/history',
];

export function isPathAllowedForUser(
  user: FamLoginUser | null | undefined,
  pathname: string,
): boolean {
  if (!isSubmitterOnly(user)) {
    // Holders of any privileged role aren't gated here yet — open for
    // now. Per-role restrictions for Reviewer / View-Only / etc. will
    // be wired in a follow-up.
    return true;
  }
  return SUBMITTER_ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Where to land the user when they hit `/`, `/auth/callback`, or any
 * page that's been removed out from under them (e.g. after deleting an
 * FSP). Submitter-only → /submission-history; anyone with a privileged
 * role → /search. Route-guard fallbacks and the FspInformation
 * back-button both call this so the user never ends up on a screen
 * they can't load.
 */
export function defaultRouteForUser(user: FamLoginUser | null | undefined): string {
  return isSubmitterOnly(user) ? '/submission-history' : '/search';
}

/**
 * @return true when the user holds {@code FSPTS_VIEW_ONLY} and no
 *     other recognised role. View-Only users see every screen they're
 *     allowed on but cannot mutate anything regardless of FSP status.
 */
export function isViewOnly(user: FamLoginUser | null | undefined): boolean {
  const roles = user?.roles ?? [];
  return roles.includes('FSPTS_VIEW_ONLY') && roles.length === 1;
}

/**
 * Per-FSP edit gate. Drives the visibility / disabled state of every
 * mutation affordance across the FSP Information page tabs
 * (Information, Attachments, Stocking Standards). Rules:
 *
 * <ul>
 *   <li>View-Only role → never editable.</li>
 *   <li>Submitter-only role + FSP status = SUB → locked out while the
 *       FSP is under review. They can still edit Drafts (their primary
 *       workflow) and read Approved / Effective / etc. without
 *       affordances (the existing per-status gates already cover those).</li>
 *   <li>Any other role (Admin, Reviewer, DecisionMaker, ViewAll) →
 *       open, defers to the existing per-status / per-tab logic.</li>
 * </ul>
 */
export function canEditFsp(
  user: FamLoginUser | null | undefined,
  fspStatusCode: string | null | undefined,
): boolean {
  if (isViewOnly(user)) return false;
  if (isSubmitterOnly(user) && fspStatusCode === 'SUB') return false;
  return true;
}

/**
 * @return true when the user should see the editable Workflow tab on
 *     the FSP Information page (DDM decision, OTBH, extension review
 *     edits). Hidden from Submitter-only and View-Only because nothing
 *     on that tab applies to them. The read-only "History" audit tab
 *     stays visible regardless.
 */
export function canSeeWorkflowTab(
  user: FamLoginUser | null | undefined,
): boolean {
  return !isSubmitterOnly(user) && !isViewOnly(user);
}
