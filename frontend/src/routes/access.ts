import type { FamLoginUser, ROLE_TYPE } from '@/context/auth/types';

/**
 * Access rules, single-effective-role model (no stacking — a user resolves to
 * exactly one role; see authUtils.highestRole). Mirrored on the backend by
 * FspAuthorities (@PreAuthorize) + the WorkflowService / FspAccessGuard status
 * checks. Menu, page, and capability gating all derive from the one role.
 *
 *   Role            Menus                                         Edit / action
 *   Administrator   all except Submission History                 edit unless APP/INE/SUB; amend/extend/replace; workflow (any)
 *   Decision Maker  FSP Search, Inbox, Reports, Standards Search  workflow on Submitted only; no edits
 *   Reviewer        FSP Search, Inbox, Reports, Standards Search  read-only
 *   View All        FSP Search, Inbox, Reports, Standards Search  read-only
 *   Submitter       Submit FSP, Standards Search, Submission Hist edit only while Draft; amend/extend/replace when APP/INE; own org
 *   View Only       Standards Search, Submission History          read-only; own org
 */

/** Internal (ministry) roles — share a menu set, never client-tied. */
const INTERNAL_ROLES: ROLE_TYPE[] = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
];

/** The user's single effective role (or undefined when none). */
export function effectiveRole(
  user: FamLoginUser | null | undefined,
): ROLE_TYPE | undefined {
  return user?.roles?.[0];
}

/** @return true when the user's effective role is Administrator. */
export function isAdministrator(user: FamLoginUser | null | undefined): boolean {
  return effectiveRole(user) === 'FSPTS_ADMINISTRATOR';
}

/**
 * Roles permitted to create / modify FSP content (Administrator, Submitter).
 * Role-level only — the per-status rule is {@link canEditFsp}. Mirrors backend
 * {@code FspAuthorities.CONTENT_EDIT}.
 */
export function canEditFspContent(user: FamLoginUser | null | undefined): boolean {
  const r = effectiveRole(user);
  return r === 'FSPTS_ADMINISTRATOR' || r === 'FSPTS_SUBMITTER';
}

/**
 * Roles permitted to take workflow actions (Administrator, Decision Maker).
 * Per-status scoping (Decision Makers only while a plan is in review) is
 * applied in {@code WorkflowDataTab} and enforced in the backend
 * {@code WorkflowService}. Mirrors backend {@code FspAuthorities.WORKFLOW_DECISION}.
 */
export function canActionWorkflow(user: FamLoginUser | null | undefined): boolean {
  const r = effectiveRole(user);
  return r === 'FSPTS_ADMINISTRATOR' || r === 'FSPTS_DECISION_MAKER';
}

/**
 * Per-FSP content-edit gate (Information / Attachments / Stocking Standards /
 * FDU). Status rules:
 *
 * <ul>
 *   <li><b>Administrator</b> — editable in every status <em>except</em>
 *       Approved, In-Effect, or Submitted.</li>
 *   <li><b>Submitter</b> — editable only while the plan is a Draft.</li>
 *   <li>everyone else — never editable.</li>
 * </ul>
 *
 * The Amend / Extend / Replace header actions are a separate flow (see
 * {@code FspInformation}); they're allowed for Administrator / Submitter on
 * Approved / In-Effect plans even though direct editing is locked there.
 */
export function canEditFsp(
  user: FamLoginUser | null | undefined,
  fspStatusCode: string | null | undefined,
): boolean {
  const r = effectiveRole(user);
  const s = (fspStatusCode ?? '').toUpperCase();
  if (r === 'FSPTS_ADMINISTRATOR') return !['APP', 'INE', 'SUB'].includes(s);
  if (r === 'FSPTS_SUBMITTER') return s === 'DFT';
  return false;
}

/**
 * @return true when the user should see the Workflow Data tab. It's for the
 *     internal roles — Administrator / Decision Maker action it (status-gated),
 *     Reviewer / View-All read it. Submitter / View-Only never see it.
 */
export function canSeeWorkflowTab(user: FamLoginUser | null | undefined): boolean {
  const r = effectiveRole(user);
  return !!r && INTERNAL_ROLES.includes(r);
}

/**
 * Page access by role — the source of truth for both the route guard
 * (App.tsx) and which paths a role may load. Prefix-matched (exact or
 * `prefix + "/"`). Pages NOT listed — FSP detail (`/fsp/*`), `/org-select`,
 * `/auth/callback`, `/standards-search` — are open to any authenticated role.
 */
const PAGE_ROLES: ReadonlyArray<{ prefix: string; roles: ROLE_TYPE[] }> = [
  { prefix: '/search', roles: INTERNAL_ROLES },
  { prefix: '/inbox', roles: INTERNAL_ROLES },
  { prefix: '/reports', roles: INTERNAL_ROLES },
  { prefix: '/data-submission', roles: ['FSPTS_ADMINISTRATOR', 'FSPTS_SUBMITTER'] },
  { prefix: '/admin', roles: ['FSPTS_ADMINISTRATOR'] },
  { prefix: '/submission-history', roles: ['FSPTS_SUBMITTER', 'FSPTS_VIEW_ONLY'] },
];

export function isPathAllowedForUser(
  user: FamLoginUser | null | undefined,
  pathname: string,
): boolean {
  const r = effectiveRole(user);
  const match = PAGE_ROLES.find(
    (p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`),
  );
  if (!match) return true; // open page (FSP detail, standards search, infra)
  return !!r && match.roles.includes(r);
}

/**
 * Where to land the user on `/`, `/auth/callback`, or any page pulled out from
 * under them. Internal roles → /search; client-tied roles (Submitter / View
 * Only) → /submission-history (a page both can load). Callers rely on this so
 * the user never lands on a screen their role can't open.
 */
export function defaultRouteForUser(user: FamLoginUser | null | undefined): string {
  const r = effectiveRole(user);
  return r && INTERNAL_ROLES.includes(r) ? '/search' : '/submission-history';
}
