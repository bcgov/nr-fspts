import { Header, HeaderMenuButton, HeaderName, SkipToContent } from '@carbon/react';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { LayoutHeaderPanel } from '@/components/Layout/LayoutHeaderPanel';
import { LayoutSideNav } from '@/components/Layout/LayoutSideNav';
import { useAuth } from '@/context/auth/useAuth';
import { useLayout } from '@/context/layout/useLayout';
import { defaultRouteForUser } from '@/routes/access';
import LayoutHeaderGlobalBar from './LayoutHeaderGlobalBar';
import './LayoutHeader.css';

const APP_NAME = (import.meta.env.VITE_APP_NAME as string) || 'Forest Stewardship Plan Tracking System';

export const LayoutHeader: FC = () => {
  const { isSideNavExpanded, toggleSideNav } = useLayout();
  const { user } = useAuth();

  return (
    <Header aria-label={APP_NAME} className="bc-header" data-testid="bc-header__header">
      <SkipToContent />
      <HeaderMenuButton
        aria-label={isSideNavExpanded ? 'Close menu' : 'Open menu'}
        isActive={isSideNavExpanded}
        onClick={toggleSideNav}
      />
      {/* "FSPTS" renders in Carbon's prefix style (regular weight) ahead of
          the bold app name — matches the design's header treatment. The title
          links to the user's default landing (internal roles → /search;
          Submitter / View Only → /submission-history) so it never points a
          client-tied user at a page they can't access. */}
      <HeaderName as={Link} to={defaultRouteForUser(user)} prefix="FSPTS">
        {APP_NAME}
      </HeaderName>

      <LayoutHeaderGlobalBar />
      <LayoutHeaderPanel />
      <LayoutSideNav />
    </Header>
  );
};

export default LayoutHeader;
