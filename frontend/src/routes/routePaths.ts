import {
  Catalog,
  ChartLineData,
  Notification,
  Report,
  Search,
  Time,
  UserAdmin,
} from '@carbon/icons-react';
import type {ComponentType} from 'react';

// Each menu entry is either a leaf (renders as <SideNavLink>) or a parent
// with children (renders as <SideNavMenu> + <SideNavMenuItem>s). Top-level
// `roles` gate the whole branch; if absent, the entry is shown to every
// authenticated user.
//
// Roles use the canonical FSPTS names from auth.ts (mirrors backend
// ca.bc.gov.nrs.fsp.api.security.FsptsRoles).
export type MenuLeaf = {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType;
  roles?: string[];
};

export type MenuParent = {
  id: string;
  label: string;
  icon?: ComponentType;
  roles?: string[];
  children: MenuLeaf[];
};

export type MenuItem = MenuLeaf | MenuParent;

export function isMenuParent(item: MenuItem): item is MenuParent {
  return 'children' in item;
}

// Source of truth for the SideNav. Mirrors the structure of the legacy
// NavBar.tsx; the deeply-nested "Search > Links > FTA" branch was flattened
// to a single level because Carbon's SideNav supports only one level of
// nesting.
// Sorted alphabetically by label. New entries should slot in by name to
// keep the SideNav scannable — don't append to the end.
const NAV: MenuItem[] = [
  {
    // Single-entry top-level leaf; if more submission flows land
    // later, re-introduce a parent submenu. Only content-editing roles
    // submit FSPs — Decision Makers and read-only roles never see it.
    id: 'Data Submission',
    label: 'Data Submission',
    path: '/data-submission',
    icon: Catalog,
    roles: ['FSPTS_ADMINISTRATOR', 'FSPTS_SUBMITTER'],
  },
  {
    id: 'District Notification',
    label: 'District Notification',
    path: '/admin/district-notification',
    icon: UserAdmin,
    roles: ['FSPTS_ADMINISTRATOR'],
  },
  {
    id: 'FSP Search',
    label: 'FSP Search',
    path: '/search',
    icon: Search,
  },
  {
    id: 'Inbox',
    label: 'Inbox',
    path: '/inbox',
    icon: Notification,
  },
  {
    id: 'Reports',
    label: 'Reports',
    path: '/reports/jcrs',
    icon: Report,
  },
  {
    // FSP501 — Stocking Standards Search. Separate from FSP Search
    // because the criteria + result columns are entirely different.
    id: 'Standards Search',
    label: 'Standards Search',
    path: '/standards-search',
    icon: Search,
  },
  {
    // BCeID submitters' read-only audit of their org's submissions.
    // Hidden from IDIR users — they have Inbox / Search / Reports for
    // the same info.
    id: 'Submission History',
    label: 'Submission History',
    path: '/submission-history',
    icon: Time,
  },
  // Kept commented so the icon import doesn't tree-shake — wire in if we
  // ever add a dashboard route. Removing for now keeps the SideNav focused.
  // { id: 'Dashboard', label: 'Dashboard', path: '/welcome', icon: ChartLineData },
];

/**
 * Submitter-only users get a deliberately narrow nav — they have no
 * business touching admin or DDM-side screens, and pages like Search /
 * Inbox / Reports either don't apply or carry confusing extra
 * affordances. Restricting the menu to what they actually do prevents
 * support tickets and keeps the SPA's screen logic from having to gate
 * every privileged widget separately.
 *
 * <p>The "submitter-only" determination is made by the caller (via
 * {@code isSubmitterOnly} in routes/access.ts) so this list stays
 * declarative — IDP doesn't enter into it. An IDIR user with only the
 * Submitter role sees the same minimal nav as a BCeID submitter.
 */
const SUBMITTER_ONLY_ALLOWED_IDS = new Set(['Data Submission', 'Submission History']);

/**
 * Nav entries that only make sense when the user can submit on behalf
 * of a forest-client org. Hidden from users without the Submitter role
 * — the underlying route stays mounted so a support user can still
 * link into it directly.
 */
const SUBMITTER_ROLE_REQUIRED_IDS = new Set(['Submission History']);

// Discourage tree-shaking of the unused icon. (TS otherwise complains.)
void ChartLineData;

/**
 * @param userRoles  the user's canonical FSPTS role list.
 * @param submitterOnly  true when the user has no privileged role
 *     (e.g. Admin / Reviewer / DecisionMaker). Limits the menu to the
 *     submitter-only short list. Determined by {@code isSubmitterOnly}
 *     in routes/access.ts; passed in so this module stays free of
 *     auth-context dependencies.
 *
 * <p>Per-entry {@code roles} gates (e.g. Data Submission →
 * Admin/Submitter, District Notification → Admin) handle role-scoped
 * visibility, so read-only and Decision-Maker users simply don't match
 * those entries.
 */
export function getMenuEntries(
  userRoles: string[],
  submitterOnly: boolean,
): MenuItem[] {
  const has = (required?: string[]) =>
    !required || required.length === 0 || required.some((r) => userRoles.includes(r));
  const roleFiltered = NAV.filter((item) => has(item.roles));
  if (submitterOnly) {
    return roleFiltered.filter((item) => SUBMITTER_ONLY_ALLOWED_IDS.has(item.id));
  }
  // Privileged role holders: drop entries that only make sense for
  // users who can act as a submitter.
  const hasSubmitterRole = userRoles.includes('FSPTS_SUBMITTER');
  return roleFiltered.filter(
    (item) => hasSubmitterRole || !SUBMITTER_ROLE_REQUIRED_IDS.has(item.id),
  );
}
