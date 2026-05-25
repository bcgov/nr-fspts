import { useState, type ReactNode } from 'react';
import { LayoutContext } from './LayoutContext';

export const LayoutProvider = ({ children }: { children: ReactNode }) => {
  const [isSideNavExpanded, setSideNavExpanded] = useState(false);
  const [isHeaderPanelOpen, setHeaderPanelOpen] = useState(false);

  return (
    <LayoutContext.Provider
      value={{
        isSideNavExpanded,
        toggleSideNav: () => setSideNavExpanded((prev) => !prev),
        closeSideNav: () => setSideNavExpanded(false),
        isHeaderPanelOpen,
        toggleHeaderPanel: () => setHeaderPanelOpen((prev) => !prev),
        closeHeaderPanel: () => setHeaderPanelOpen(false),
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
