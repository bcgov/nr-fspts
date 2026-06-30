import {
  DistrictNotificationIcon,
  FspSearchIcon,
  InboxIcon,
  ReportsIcon,
  StandardsSearchIcon,
  SubmissionHistoryIcon,
  SubmitFspIcon,
} from '@/components/Layout/navIcons';
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
// Ordered to match the FSP design's side nav (fsp_search_v1.html):
// FSP Search, Inbox, Data Submission, District Notification, Reports,
// Standards Search, Submission History.
const NAV: MenuItem[] = [
  {
    // Internal (ministry) roles only — Submitter / View-Only never search.
    id: 'FSP Search',
    label: 'FSP Search',
    path: '/search',
    icon: FspSearchIcon,
    roles: [
      'FSPTS_ADMINISTRATOR',
      'FSPTS_DECISION_MAKER',
      'FSPTS_REVIEWER',
      'FSPTS_VIEW_ALL',
    ],
  },
  {
    id: 'Inbox',
    label: 'Inbox',
    path: '/inbox',
    icon: InboxIcon,
    roles: [
      'FSPTS_ADMINISTRATOR',
      'FSPTS_DECISION_MAKER',
      'FSPTS_REVIEWER',
      'FSPTS_VIEW_ALL',
    ],
  },
  {
    // Single-entry top-level leaf; if more submission flows land
    // later, re-introduce a parent submenu. Only content-editing roles
    // submit FSPs — Decision Makers and read-only roles never see it.
    id: 'Data Submission',
    label: 'Data Submission',
    path: '/data-submission',
    icon: SubmitFspIcon,
    roles: ['FSPTS_ADMINISTRATOR', 'FSPTS_SUBMITTER'],
  },
  {
    id: 'District Notification',
    label: 'District Notification',
    path: '/admin/district-notification',
    icon: DistrictNotificationIcon,
    roles: ['FSPTS_ADMINISTRATOR'],
  },
  {
    id: 'Reports',
    label: 'Reports',
    path: '/reports/jcrs',
    icon: ReportsIcon,
    roles: [
      'FSPTS_ADMINISTRATOR',
      'FSPTS_DECISION_MAKER',
      'FSPTS_REVIEWER',
      'FSPTS_VIEW_ALL',
    ],
  },
  {
    // FSP501 — Stocking Standards Search. Separate from FSP Search
    // because the criteria + result columns are entirely different.
    id: 'Standards Search',
    label: 'Standards Search',
    path: '/standards-search',
    icon: StandardsSearchIcon,
  },
  {
    // Client-tied roles only — their read-only audit of their org's
    // submissions. Internal roles use Inbox / Search / Reports instead.
    id: 'Submission History',
    label: 'Submission History',
    path: '/submission-history',
    icon: SubmissionHistoryIcon,
    roles: ['FSPTS_SUBMITTER', 'FSPTS_VIEW_ONLY'],
  },
  // Kept commented so the icon import doesn't tree-shake — wire in if we
  // ever add a dashboard route. Removing for now keeps the SideNav focused.
  // { id: 'Dashboard', label: 'Dashboard', path: '/welcome', icon: ChartLineData },
];

/**
 * The visible nav for the user's single effective role. Every entry carries
 * an explicit {@code roles} allow-list (except Standards Search, open to all),
 * so role-scoped visibility is fully declarative — no submitter-only special
 * casing. With the no-stacking model {@code userRoles} is a single-element
 * array, so an entry shows iff its allow-list contains that role.
 *
 * @param userRoles  the user's canonical FSPTS role(s).
 */
export function getMenuEntries(userRoles: string[]): MenuItem[] {
  const has = (required?: string[]) =>
    !required || required.length === 0 || required.some((r) => userRoles.includes(r));
  return NAV.filter((item) => has(item.roles));
}
