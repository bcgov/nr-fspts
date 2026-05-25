import { useContext } from 'react';
import { LayoutContext } from './LayoutContext';

export const useLayout = () => {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return ctx;
};
