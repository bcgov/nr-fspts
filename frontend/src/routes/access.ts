import type { FamLoginUser, ROLE_TYPE } from '@/context/auth/types';

/**
 * Access rules, single-effective-role model (no stacking — a user resolves to
 * exactly one role; see authUtils.highestRole). Mirrored on the backend by
 * FspAuthorities (@PreAuthorize) + the WorkflowService / FspAccessGuard status
 * checks. Menu, page, and capability gating all derive from the one role.
 *
 * Source of truth: FSPTS Permission Matrix (by status), client-confirmed
 * 2026-07-06. Key rules encoded below:
 *
 *   Role            Menus                                         Edit / action
 *   Administrator   all except Submission History                 edit content in ANY status; amend/extend/replace; workflow: clarification/reverse/revert/extension (NOT the review decisions)
 *   Decision Maker  FSP Search, Inbox, Reports, Standards Search  no content edits (attachments on SUB/OHS); all review decisions
 *   Reviewer        FSP Search, Inbox, Reports, Standards Search  no content edits (attachments on SUB); all review decisions
 *   View All        FSP Search, Inbox, Reports, Standards Search  read-only; sees APP/INE/REJ only
 *   Submitter       Submit FSP, Standards Search, Submission Hist edit content + attachments only while Draft; amend/extend/replace when APP/INE; own org
 *   View Only       Standards Search, Submission History          read-only; own org (all statuses)
 *
 * Attachments (B2) are a separate, more permissive rule than general content
 * (B1) — see {@link canEditAttachments} vs {@link canEditFsp}.
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
 * Roles permitted to reach the workflow actions (Administrator, Decision
 * Maker, Reviewer). Which action + status each may take is scoped in
 * {@code WorkflowDataTab} and enforced in the backend {@code WorkflowService}
 * per FSPTS Permission Matrix section D:
 * Decision Maker + Reviewer own the review decisions (milestones, Approve,
 * Reject, Offer/Record OTBH); the Administrator is excluded from those but
 * keeps request-clarification, extension, and reverse/revert. Mirrors backend
 * {@code FspAuthorities.WORKFLOW_DECISION}.
 */
export function canActionWorkflow(user: FamLoginUser | null | undefined): boolean {
  const r = effectiveRole(user);
  return (
    r === 'FSPTS_ADMINISTRATOR' ||
    r === 'FSPTS_DECISION_MAKER' ||
    r === 'FSPTS_REVIEWER'
  );
}

/**
 * Per-FSP <b>general content</b>-edit gate (Information / Stocking Standards /
 * FDU spatial) — matrix section B1. Attachments have their own, more
 * permissive rule: {@link canEditAttachments}. Status rules:
 *
 * <ul>
 *   <li><b>Administrator</b> — editable in <em>every</em> status.</li>
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
  if (r === 'FSPTS_ADMINISTRATOR') return true;
  if (r === 'FSPTS_SUBMITTER') return s === 'DFT';
  return false;
}

/**
 * Per-FSP <b>attachment</b>-edit/upload gate — matrix section B2, which is
 * more permissive than general content edits ({@link canEditFsp}) because the
 * ministry attaches review documents while a plan is under decision:
 *
 * <ul>
 *   <li><b>Administrator</b> — every status.</li>
 *   <li><b>Submitter</b> — Draft only (own org).</li>
 *   <li><b>Decision Maker</b> — Submitted and Opportunity-to-be-Heard.</li>
 *   <li><b>Reviewer</b> — Submitted only.</li>
 *   <li>everyone else — never.</li>
 * </ul>
 *
 * Ownership (own-org) is enforced server-side by the FSP access guard; this
 * governs the per-status affordance only.
 */
export function canEditAttachments(
  user: FamLoginUser | null | undefined,
  fspStatusCode: string | null | undefined,
): boolean {
  const r = effectiveRole(user);
  const s = (fspStatusCode ?? '').toUpperCase();
  if (r === 'FSPTS_ADMINISTRATOR') return true;
  if (r === 'FSPTS_SUBMITTER') return s === 'DFT';
  if (r === 'FSPTS_DECISION_MAKER') return s === 'SUB' || s === 'OHS';
  if (r === 'FSPTS_REVIEWER') return s === 'SUB';
  return false;
}

/**
 * Role gate for the <b>DDM decision-letter</b> attachment category. The
 * decision letter is a ministry review document, so only the internal
 * review roles — Administrator, Decision Maker, Reviewer — may file an
 * attachment under it. Other roles (Submitter, View-All, View-Only) never
 * see that category in the Add-attachment dialog. Role-level only; the
 * per-status upload affordance is still {@link canEditAttachments}.
 */
export function canAttachDecisionLetter(
  user: FamLoginUser | null | undefined,
): boolean {
  const r = effectiveRole(user);
  return (
    r === 'FSPTS_ADMINISTRATOR' ||
    r === 'FSPTS_DECISION_MAKER' ||
    r === 'FSPTS_REVIEWER'
  );
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
