import { UserAvatar } from '@carbon/icons-react';
import { HeaderGlobalAction, HeaderGlobalBar } from '@carbon/react';
import type { FC } from 'react';
import ThemeToggle from '@/components/Layout/ThemeToggle';
import { useLayout } from '@/context/layout/useLayout';

const LayoutHeaderGlobalBar: FC = () => {
  const { toggleHeaderPanel, isHeaderPanelOpen } = useLayout();

  return (
    <HeaderGlobalBar>
      <HeaderGlobalAction aria-label="Theme" tooltipAlignment="end">
        <ThemeToggle />
      </HeaderGlobalAction>

      <HeaderGlobalAction
        aria-label="User settings"
        tooltipAlignment="end"
        onClick={toggleHeaderPanel}
        isActive={isHeaderPanelOpen}
        className="profile-action-button"
      >
        <UserAvatar size={20} />
      </HeaderGlobalAction>
    </HeaderGlobalBar>
  );
};

export default LayoutHeaderGlobalBar;
