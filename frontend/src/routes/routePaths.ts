import {Catalog, ChartLineData, Notification, Report, Search, UserAdmin,} from '@carbon/icons-react';
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
    // later, re-introduce a parent submenu.
    id: 'Data Submission',
    label: 'Data Submission',
    path: '/data-submission',
    icon: Catalog,
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
  // Kept commented so the icon import doesn't tree-shake — wire in if we
  // ever add a dashboard route. Removing for now keeps the SideNav focused.
  // { id: 'Dashboard', label: 'Dashboard', path: '/welcome', icon: ChartLineData },
];

// Discourage tree-shaking of the unused icon. (TS otherwise complains.)
void ChartLineData;

export function getMenuEntries(userRoles: string[]): MenuItem[] {
  const has = (required?: string[]) =>
    !required || required.length === 0 || required.some((r) => userRoles.includes(r));
  return NAV.filter((item) => has(item.roles));
}
