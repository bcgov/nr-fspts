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
 * Roles permitted to create or modify FSP content — plan information,
 * attachments, stocking standards, FDU licences, extension *requests*,
 * the Amend / Submit / Replace / Delete header actions, and the Data
 * Submission upload. Mirrors the backend {@code FspAuthorities.CONTENT_EDIT}
 * allow-list.
 *
 * <p>Decision Makers are intentionally excluded: they action the workflow
 * (decisions), they don't edit licensee content. Reviewer / View-All /
 * View-Only hold no edit role, so they're read-only here too.
 */
const CONTENT_EDIT_ROLES: ROLE_TYPE[] = ['FSPTS_ADMINISTRATOR', 'FSPTS_SUBMITTER'];

/** @return true when the user may create / modify FSP content. */
export function canEditFspContent(user: FamLoginUser | null | undefined): boolean {
  return (user?.roles ?? []).some((r) => CONTENT_EDIT_ROLES.includes(r));
}

/**
 * Roles permitted to take workflow actions (DDM decision, OTBH, review
 * milestones, extension decisions). Mirrors backend
 * {@code FspAuthorities.WORKFLOW_DECISION}. Per-action status scoping
 * (e.g. Decision Makers only while a plan is in review) is applied in
 * {@code WorkflowDataTab}.
 */
const WORKFLOW_ROLES: ROLE_TYPE[] = ['FSPTS_ADMINISTRATOR', 'FSPTS_DECISION_MAKER'];

/** @return true when the user may take any workflow action. */
export function canActionWorkflow(user: FamLoginUser | null | undefined): boolean {
  return (user?.roles ?? []).some((r) => WORKFLOW_ROLES.includes(r));
}

/** @return true when the user holds the Administrator role. */
export function isAdministrator(user: FamLoginUser | null | undefined): boolean {
  return (user?.roles ?? []).includes('FSPTS_ADMINISTRATOR');
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
  if (isSubmitterOnly(user)) {
    return SUBMITTER_ALLOWED_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
  }
  // Privileged (non-submitter-only) roles: gate the data-entry and admin
  // areas by capability — Decision Makers and read-only roles can't reach
  // Data Submission; only Administrators reach /admin. Everything else
  // (search / inbox / reports / FSP detail) stays open, with each page's
  // own affordance gates deciding read vs write.
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (matches('/data-submission') && !canEditFspContent(user)) return false;
  if (matches('/admin') && !isAdministrator(user)) return false;
  return true;
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
 * Per-FSP content-edit gate. Drives the visibility / disabled state of
 * every mutation affordance across the FSP Information page tabs
 * (Information, Attachments, Stocking Standards, FDU licences). Rules:
 *
 * <ul>
 *   <li>No content-edit role (Decision Maker, Reviewer, View-All,
 *       View-Only) → never editable.</li>
 *   <li>Submitter-only role + FSP status = SUB → locked out while the
 *       FSP is under review. They can still edit Drafts (their primary
 *       workflow) and read everything else without affordances.</li>
 *   <li>Administrator / Submitter otherwise → defers to the existing
 *       per-status / per-tab logic.</li>
 * </ul>
 */
export function canEditFsp(
  user: FamLoginUser | null | undefined,
  fspStatusCode: string | null | undefined,
): boolean {
  if (!canEditFspContent(user)) return false;
  if (isSubmitterOnly(user) && fspStatusCode === 'SUB') return false;
  return true;
}

/**
 * @return true when the user should see the Workflow tab on the FSP
 *     Information page (DDM decision, OTBH, extension, review milestones).
 *     Visible to every non-submitter role. Reviewers / View-All /
 *     View-Only see the workflow state but take no action (the tab
 *     renders read-only for anyone without {@link canActionWorkflow}).
 *     Hidden only from Submitter-only users, for whom nothing on the tab
 *     applies.
 */
export function canSeeWorkflowTab(
  user: FamLoginUser | null | undefined,
): boolean {
  return !isSubmitterOnly(user);
}
