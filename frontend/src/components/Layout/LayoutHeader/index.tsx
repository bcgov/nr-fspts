import { Header, HeaderMenuButton, HeaderName, SkipToContent } from '@carbon/react';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { LayoutHeaderPanel } from '@/components/Layout/LayoutHeaderPanel';
import { LayoutSideNav } from '@/components/Layout/LayoutSideNav';
import { useLayout } from '@/context/layout/useLayout';
import LayoutHeaderGlobalBar from './LayoutHeaderGlobalBar';
import './LayoutHeader.css';

const APP_NAME = (import.meta.env.VITE_APP_NAME as string) || 'Forest Stewardship Plan Tracking System';

export const LayoutHeader: FC = () => {
  const { isSideNavExpanded, toggleSideNav } = useLayout();

  return (
    <Header aria-label={APP_NAME} className="bc-header" data-testid="bc-header__header">
      <SkipToContent />
      <HeaderMenuButton
        aria-label={isSideNavExpanded ? 'Close menu' : 'Open menu'}
        isActive={isSideNavExpanded}
        onClick={toggleSideNav}
      />
      <HeaderName as={Link} to="/welcome" prefix="">
        {APP_NAME}
      </HeaderName>

      <LayoutHeaderGlobalBar />
      <LayoutHeaderPanel />
      <LayoutSideNav />
    </Header>
  );
};

export default LayoutHeader;
