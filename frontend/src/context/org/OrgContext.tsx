import { createContext } from 'react';

/**
 * Currently active forest-client number for a BCeID submitter who
 * belongs to multiple client orgs (e.g. an agent acting on behalf of
 * several licensees). IDIR users and single-org BCeID users get
 * {@code null} — they don't need the picker.
 *
 * <p>The header X-FSPTS-Active-Org-Client-Number on each API request
 * carries this value to the backend, which validates it against the
 * user's own JWT groups before using it to scope queries.
 */
export interface OrgContextShape {
  activeOrgClientNumber: string | null;
  /** Available submitter client numbers (empty when not a multi-org BCeID submitter). */
  availableOrgClientNumbers: string[];
  /** True when the user must pick an org before continuing. */
  needsOrgSelection: boolean;
  /** Persist a new active client number. */
  setActiveOrgClientNumber: (clientNumber: string) => void;
  /** Clear the active org (used on sign out). */
  clearActiveOrgClientNumber: () => void;
}

export const OrgContext = createContext<OrgContextShape | undefined>(undefined);
