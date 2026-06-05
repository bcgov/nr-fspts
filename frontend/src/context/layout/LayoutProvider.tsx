import { useEffect, useState, type ReactNode } from 'react';
import { LayoutContext } from './LayoutContext';

// SideNav defaults to expanded and remembers the user's last
// open/close choice across reloads. Persisted via localStorage so
// navigation between pages always restores the user's preference.
const SIDE_NAV_STORAGE_KEY = 'fsp.layout.sideNavOpen';

const loadSideNavInitial = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SIDE_NAV_STORAGE_KEY);
    if (raw === null) return true; // default: open
    return raw === 'true';
  } catch {
    return true;
  }
};

export const LayoutProvider = ({ children }: { children: ReactNode }) => {
  const [isSideNavExpanded, setSideNavExpanded] = useState<boolean>(loadSideNavInitial);
  const [isHeaderPanelOpen, setHeaderPanelOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIDE_NAV_STORAGE_KEY, String(isSideNavExpanded));
    } catch {
      /* quota / private-mode — non-fatal */
    }
  }, [isSideNavExpanded]);

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
