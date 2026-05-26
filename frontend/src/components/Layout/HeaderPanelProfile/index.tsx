import { Asleep, Light, Logout } from '@carbon/icons-react';
import { SideNavLink } from '@carbon/react';
import type { FC } from 'react';
import AvatarImage from '@/components/Layout/AvatarImage';
import { useAuth } from '@/context/auth/useAuth';
import { useTheme } from '@/context/theme/useTheme';
import './HeaderPanelProfile.css';

const HeaderPanelProfile: FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.displayName
    || '';

  return (
    <div className="my-profile-container">
      <div className="user-info-section">
        <div className="user-image">
          <AvatarImage userName={fullName} size="large" />
        </div>
        <div className="user-data">
          <p className="user-name">{fullName || 'User'}</p>
          {user?.userName ? <p>{`${user.idpProvider ?? 'IDIR'}: ${user.userName}`}</p> : null}
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
