import { SideNav, SideNavItems, SideNavLink, SideNavMenu, SideNavMenuItem } from '@carbon/react';
import { useEffect, type FC } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth/useAuth';
import { useLayout } from '@/context/layout/useLayout';
import { getMenuEntries, isMenuParent, type MenuItem, type MenuLeaf } from '@/routes/routePaths';
import './LayoutSideNav.css';

export const LayoutSideNav: FC = () => {
  const { isSideNavExpanded, closeSideNav } = useLayout();
  const location = useLocation();
  const { user } = useAuth();
  const roles = user?.roles ?? [];

  useEffect(() => {
    if (!isSideNavExpanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('.side-nav-drawer, .cds--header__menu-toggle')) return;
      closeSideNav();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isSideNavExpanded, closeSideNav]);

  const renderLeaf = (route: MenuLeaf) => (
    <SideNavLink
      data-testid={`side-nav-link-${route.id}`}
      key={route.id}
      as={Link}
      to={route.path}
      isActive={route.path === location.pathname}
      renderIcon={route.icon}
      onClick={closeSideNav}
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
            onClick={closeSideNav}
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
      </SideNavItems>
    </SideNav>
  );
};

export default LayoutSideNav;
