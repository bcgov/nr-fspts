import { createContext } from 'react';

export type LayoutContextType = {
  isSideNavExpanded: boolean;
  toggleSideNav: () => void;
  closeSideNav: () => void;
  isHeaderPanelOpen: boolean;
  toggleHeaderPanel: () => void;
  closeHeaderPanel: () => void;
};

export const LayoutContext = createContext<LayoutContextType | undefined>(undefined);
