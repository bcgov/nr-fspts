import { Asleep, Light, Logout } from '@carbon/icons-react';
import { SideNavLink } from '@carbon/react';
import { useEffect, useState, type FC } from 'react';
import AvatarImage from '@/components/Layout/AvatarImage';
import type { ROLE_TYPE } from '@/context/auth/types';
import { useAuth } from '@/context/auth/useAuth';
import { useOrg } from '@/context/org/useOrg';
import { useTheme } from '@/context/theme/useTheme';
import { searchClients } from '@/services/clientSearch';
import './HeaderPanelProfile.css';

// Cognito's idpProvider claim arrives in shouty all-caps. Turn the
// values we care about into the labels the user actually expects to
// see in their profile. Anything we don't recognise falls back to the
// raw claim so we don't accidentally lie about the IDP.
const PROVIDER_LABEL: Record<string, string> = {
  IDIR: 'IDIR',
  BCEIDBUSINESS: 'Business BCeID',
};

// Friendly labels for the FSPTS roles shown beside the user's name.
const ROLE_LABEL: Record<ROLE_TYPE, string> = {
  FSPTS_ADMINISTRATOR: 'Administrator',
  FSPTS_DECISION_MAKER: 'Decision Maker',
  FSPTS_REVIEWER: 'Reviewer',
  FSPTS_VIEW_ALL: 'View All',
  FSPTS_VIEW_ONLY: 'View Only',
  FSPTS_SUBMITTER: 'Submitter',
};

// A user can hold several roles; show the most privileged one as their
// "current role" (most-privileged first). Mirrors the app's access
// model where any privileged role outranks Submitter.
const ROLE_PRIORITY: ROLE_TYPE[] = [
  'FSPTS_ADMINISTRATOR',
  'FSPTS_DECISION_MAKER',
  'FSPTS_REVIEWER',
  'FSPTS_VIEW_ALL',
  'FSPTS_VIEW_ONLY',
  'FSPTS_SUBMITTER',
];

const HeaderPanelProfile: FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { activeOrgClientNumber } = useOrg();
  const [orgName, setOrgName] = useState<string | null>(null);

  // Look up the active org's forest-client name once. The picker page
  // does this same enrichment via searchClients; we duplicate the call
  // here so the profile panel stays self-contained (no shared cache).
  // Bounded — one request per client number per mount.
  useEffect(() => {
    if (!activeOrgClientNumber) {
      setOrgName(null);
      return;
    }
    let cancelled = false;
    searchClients({ clientNumber: activeOrgClientNumber, size: 1 })
      .then((res) => {
        if (cancelled) return;
        const name = res.content[0]?.clientName?.trim();
        setOrgName(name ?? null);
      })
      .catch(() => {
        if (!cancelled) setOrgName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgClientNumber]);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.displayName
    || '';

  const providerLabel = user?.idpProvider
    ? PROVIDER_LABEL[user.idpProvider] ?? user.idpProvider
    : 'IDIR';

  const primaryRole = ROLE_PRIORITY.find((r) => user?.roles?.includes(r));
  const roleLabel = primaryRole ? ROLE_LABEL[primaryRole] : null;
  const nameWithRole = roleLabel
    ? `${fullName || 'User'} (${roleLabel})`
    : fullName || 'User';

  return (
    <div className="my-profile-container">
      <div className="user-info-section">
        <div className="user-image">
          <AvatarImage userName={fullName} size="large" />
        </div>
        <div className="user-data">
          <p className="user-name">{nameWithRole}</p>
          {user?.userName ? <p>{`${providerLabel}: ${user.userName}`}</p> : null}
          {activeOrgClientNumber ? (
            <p>
              {`Organization: ${activeOrgClientNumber}${orgName ? ` — ${orgName}` : ''}`}
            </p>
          ) : null}
          {user?.email ? <p>{`Email: ${user.email}`}</p> : null}
        </div>
      </div>
      <hr className="divisory" />
      <nav className="account-nav">
        <ul>
          <SideNavLink
            className="cursor-pointer"
            renderIcon={theme === 'g100' ? Light : Asleep}
            onClick={toggleTheme}
          >
            Change theme
          </SideNavLink>
          <SideNavLink className="cursor-pointer" renderIcon={Logout} onClick={logout}>
            Log out
          </SideNavLink>
        </ul>
      </nav>
    </div>
  );
};

export default HeaderPanelProfile;
