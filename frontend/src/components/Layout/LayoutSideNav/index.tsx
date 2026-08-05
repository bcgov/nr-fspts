import { Email } from '@carbon/icons-react';
import { SideNav, SideNavItems, SideNavLink, SideNavMenu, SideNavMenuItem } from '@carbon/react';
import { type FC } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth/useAuth';
import { useLayout } from '@/context/layout/useLayout';
import { getMenuEntries, isMenuParent, type MenuItem, type MenuLeaf } from '@/routes/routePaths';
import './LayoutSideNav.css';

/** Shared support mailbox reached from the nav's bottom-pinned Support link. */
const SUPPORT_EMAIL = 'heartwood@gov.bc.ca';

export const LayoutSideNav: FC = () => {
  const { isSideNavExpanded } = useLayout();
  const location = useLocation();
  const { user } = useAuth();
  const roles = user?.roles ?? [];

  // Note: the drawer no longer auto-closes on link click or outside
  // pointer-down. The only way to dismiss it is the header X button,
  // which is the behaviour the team wanted ("stay popped out").

  const renderLeaf = (route: MenuLeaf) => (
    <SideNavLink
      data-testid={`side-nav-link-${route.id}`}
      key={route.id}
      as={Link}
      to={route.path}
      isActive={route.path === location.pathname}
      renderIcon={route.icon}
    >
      {route.label}
    </SideNavLink>
  );

  const renderParent = (item: MenuItem) => {
    if (!isMenuParent(item)) return renderLeaf(item);
    const anyChildActive = item.children.some((c) => c.path === location.pathname);
    return (
      <SideNavMenu
        data-testid={`side-nav-menu-${item.id}`}
        key={item.id}
        title={item.label}
        isActive={anyChildActive}
        defaultExpanded={anyChildActive}
        renderIcon={item.icon}
      >
        {item.children.map((child) => (
          <SideNavMenuItem
            data-testid={`side-nav-menu-item-${child.id}`}
            key={child.id}
            as={Link}
            to={child.path}
            isActive={child.path === location.pathname}
          >
            {child.label}
          </SideNavMenuItem>
        ))}
      </SideNavMenu>
    );
  };

  return (
    <SideNav
      expanded
      isPersistent={false}
      isChildOfHeader
      className={`side-nav-drawer${isSideNavExpanded ? ' side-nav-drawer--open' : ''}`}
      aria-label="Main navigation"
    >
      <SideNavItems>
        {getMenuEntries(roles).map(renderParent)}
        {/* Support — pinned to the bottom of the nav regardless of how many
            role-dependent menu entries render above it (see the flex rules in
            LayoutSideNav.css). A plain mailto: rather than a route: it opens
            the user's own mail client with the shared mailbox pre-addressed.
            The heading is hidden in the collapsed rail, where the link's
            hover tooltip carries the label instead. */}
        <li className="side-nav-support-heading" aria-hidden="true">
          Support
        </li>
        <SideNavLink
          data-testid="side-nav-link-email-support"
          href={`mailto:${SUPPORT_EMAIL}`}
          renderIcon={Email}
        >
          Report an issue
        </SideNavLink>
      </SideNavItems>
    </SideNav>
  );
};

export default LayoutSideNav;
