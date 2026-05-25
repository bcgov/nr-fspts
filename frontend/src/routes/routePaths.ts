import {
  Catalog,
  ChartLineData,
  Document,
  Notification,
  Report,
  Search,
  UserAdmin,
} from '@carbon/icons-react';
import type { ComponentType } from 'react';

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
const NAV: MenuItem[] = [
  {
    id: 'Search',
    label: 'Search',
    icon: Search,
    children: [
      { id: 'Search', label: 'Search', path: '/search' },
      { id: 'FTA', label: 'FTA', path: '/links/fta' },
      { id: 'RESULTS', label: 'RESULTS', path: '/links/results' },
      { id: 'MapView', label: 'MapView', path: '/links/mapview' },
      { id: 'CIMS', label: 'CIMS', path: '/links/cims' },
    ],
  },
  {
    id: 'Inbox',
    label: 'Inbox',
    path: '/inbox',
    icon: Notification,
  },
  {
    id: 'FSP',
    label: 'FSP',
    icon: Document,
    children: [
      { id: 'Information', label: 'FSP Information', path: '/fsp/information' },
      { id: 'Attachments', label: 'Attachments', path: '/fsp/attachments' },
      { id: 'Stocking Standards', label: 'Stocking Standards', path: '/fsp/stocking-standards' },
      { id: 'FDU/Map', label: 'FDU/Map', path: '/fsp/fdu-map' },
      { id: 'Identified Areas', label: 'Identified Areas/Map', path: '/fsp/identified-areas' },
      { id: 'Workflow', label: 'Workflow', path: '/fsp/workflow' },
      { id: 'History', label: 'History', path: '/fsp/history' },
    ],
  },
  {
    id: 'Data Submission',
    label: 'Data Submission',
    icon: Catalog,
    children: [
      { id: 'XML Submission', label: 'XML Submission', path: '/data-submission/xml' },
    ],
  },
  {
    id: 'Admin',
    label: 'Admin',
    icon: UserAdmin,
    roles: ['FSPTS_ADMINISTRATOR'],
    children: [
      { id: 'District Notification', label: 'District Notification', path: '/admin/district-notification' },
    ],
  },
  {
    id: 'Reports',
    label: 'Reports',
    icon: Report,
    children: [
      { id: 'JCRS Reports', label: 'JCRS Reports', path: '/reports/jcrs' },
    ],
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
