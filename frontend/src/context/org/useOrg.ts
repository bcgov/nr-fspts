import { useContext } from 'react';

import { OrgContext, type OrgContextShape } from './OrgContext';

/** Hook accessor for {@link OrgContext}. Throws if used outside the provider. */
export const useOrg = (): OrgContextShape => {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error('useOrg() must be used inside <OrgProvider>');
  }
  return ctx;
};

/**
 * Read-only accessor that doesn't require the React render context —
 * use from non-React modules (e.g. apiFetch). Reads from sessionStorage
 * directly so it stays in sync with what OrgProvider wrote there.
 */
export const getActiveOrgClientNumber = (): string | null => {
  try {
    return sessionStorage.getItem('fsp:activeOrgClientNumber');
  } catch {
    return null;
  }
};
