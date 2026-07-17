import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listClientOrgs } from '@/context/auth/authUtils';
import { useAuth } from '@/context/auth/useAuth';

import { OrgContext, type OrgContextShape } from './OrgContext';

/**
 * sessionStorage scopes to the browser tab, which matches the legacy
 * "per-day" expectation ("the user picks an org and works under it for
 * the day") without needing a separate clock-based expiry. Closing the
 * tab or signing out drops the choice; re-login forces a re-pick.
 */
const STORAGE_KEY = 'fsp:activeOrgClientNumber';

const readPersisted = (): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writePersisted = (value: string | null) => {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable → in-memory only */
  }
};

/**
 * Seed the active org for this tab. Prefers the per-tab sessionStorage choice;
 * failing that, adopts an `activeOrg` query param.
 *
 * The param is the new-tab handoff for map links: those open with `noopener`,
 * which gives the new tab a FRESH sessionStorage, so a multi-org BCeID user
 * would otherwise be re-prompted to pick an org before the map (and its
 * org-fenced geometry fetch) could load. The opener passes its active org in
 * the URL; we adopt it and write it through to sessionStorage synchronously
 * (during render, before any data-fetch effect fire) so apiFetch's active-org
 * header picks it up too. The reconcile effect below still validates it against
 * the user's real org list, so a tampered param can't widen access.
 */
const readInitialActiveOrg = (): string | null => {
  const persisted = readPersisted();
  if (persisted) return persisted;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('activeOrg');
    if (fromUrl) {
      writePersisted(fromUrl);
      return fromUrl;
    }
  } catch {
    /* URL / sessionStorage unavailable → fall through to null */
  }
  return null;
};

interface Props {
  children: ReactNode;
}

/**
 * Owns the BCeID active-org selection. Sits between AuthProvider and
 * the rest of the app: as soon as Auth resolves a user it computes
 * {@code availableOrgClientNumbers} from the JWT groups and decides
 * whether {@code needsOrgSelection} should gate the router.
 *
 * <p>Behaviour matrix:
 * <ul>
 *   <li>IDIR or no submitter clients → activeOrgClientNumber=null, no gate.</li>
 *   <li>BCeID + exactly 1 submitter client → auto-pick, no gate.</li>
 *   <li>BCeID + ≥2 submitter clients + nothing persisted → gate (needsOrgSelection=true).</li>
 *   <li>BCeID + ≥2 submitter clients + a persisted choice still in the list → use it, no gate.</li>
 *   <li>Persisted choice that is no longer in the user's list (role changed) → drop it, re-gate.</li>
 * </ul>
 */
const OrgProvider = ({ children }: Props) => {
  const { user, isLoggedIn, isLoading } = useAuth();
  const [activeOrgClientNumber, setActiveOrgClientNumberState] =
    useState<string | null>(() => readInitialActiveOrg());

  const availableOrgClientNumbers = useMemo(
    () =>
      user?.privileges
        ? listClientOrgs(user.privileges).map((o) => o.clientNumber)
        : [],
    [user?.privileges],
  );

  // Reconcile the persisted choice with what the JWT now says.
  // Cases:
  //   - logged out → drop the choice
  //   - exactly one option → adopt it silently (no picker)
  //   - persisted value is in the list → keep it
  //   - persisted value isn't in the list → drop it (forces a re-pick)
  useEffect(() => {
    // On a page refresh AuthProvider re-resolves the session asynchronously,
    // so `isLoggedIn` is transiently false (and the org list empty) before the
    // user hydrates. Reconciling in that window would wipe the persisted choice
    // from sessionStorage and bounce the user back to the picker. Wait until
    // auth has settled before touching the selection.
    if (isLoading) return;
    if (!isLoggedIn) {
      if (activeOrgClientNumber !== null) {
        setActiveOrgClientNumberState(null);
        writePersisted(null);
      }
      return;
    }
    if (availableOrgClientNumbers.length === 1) {
      const only = availableOrgClientNumbers[0];
      if (activeOrgClientNumber !== only) {
        setActiveOrgClientNumberState(only);
        writePersisted(only);
      }
      return;
    }
    if (
      activeOrgClientNumber &&
      !availableOrgClientNumbers.includes(activeOrgClientNumber)
    ) {
      setActiveOrgClientNumberState(null);
      writePersisted(null);
    }
  }, [isLoading, isLoggedIn, availableOrgClientNumbers, activeOrgClientNumber]);

  const setActiveOrgClientNumber = useCallback((clientNumber: string) => {
    setActiveOrgClientNumberState(clientNumber);
    writePersisted(clientNumber);
  }, []);

  const clearActiveOrgClientNumber = useCallback(() => {
    setActiveOrgClientNumberState(null);
    writePersisted(null);
  }, []);

  const needsOrgSelection =
    availableOrgClientNumbers.length > 1 && !activeOrgClientNumber;

  const value: OrgContextShape = useMemo(
    () => ({
      activeOrgClientNumber,
      availableOrgClientNumbers,
      needsOrgSelection,
      setActiveOrgClientNumber,
      clearActiveOrgClientNumber,
    }),
    [
      activeOrgClientNumber,
      availableOrgClientNumbers,
      needsOrgSelection,
      setActiveOrgClientNumber,
      clearActiveOrgClientNumber,
    ],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
};

export default OrgProvider;
