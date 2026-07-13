import { Close } from '@carbon/icons-react';
import { HeaderPanel, IconButton } from '@carbon/react';
import { useEffect, type FC } from 'react';
import HeaderPanelProfile from '@/components/Layout/HeaderPanelProfile';
import { useLayout } from '@/context/layout/useLayout';
import './LayoutHeaderPanel.css';

export const LayoutHeaderPanel: FC = () => {
  const { isHeaderPanelOpen, closeHeaderPanel } = useLayout();

  // Auto-collapse when the user clicks anywhere outside the panel. The
  // profile toggle button (.profile-action-button) is excluded — its own
  // onClick already toggles the panel, so closing here too would let the
  // click immediately reopen it. Listen on mousedown (fires before click)
  // and only while open.
  useEffect(() => {
    if (!isHeaderPanelOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('.profile-panel') ||
        target.closest('.profile-action-button')
      ) {
        return;
      }
      closeHeaderPanel();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isHeaderPanelOpen, closeHeaderPanel]);

  return (
    <HeaderPanel
      data-testid="header-panel"
      aria-label="User Profile Tab"
      className={`profile-panel${isHeaderPanelOpen ? ' profile-panel--open' : ''}`}
      expanded
    >
      <div className="right-title-section">
        <h4>My profile</h4>
        <div className="right-title-buttons">
          <IconButton kind="ghost" label="Close" onClick={closeHeaderPanel} align="bottom">
            <Close />
          </IconButton>
        </div>
      </div>
      <HeaderPanelProfile />
    </HeaderPanel>
  );
};

export default LayoutHeaderPanel;
