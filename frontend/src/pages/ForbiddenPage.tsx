import { ArrowRight, Logout } from '@carbon/icons-react';
import { Button, Column, Grid } from '@carbon/react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/context/auth/useAuth';
import { useTheme } from '@/context/theme/useTheme';
import { defaultRouteForUser } from '@/routes/access';

import './LandingPage.scss';

/**
 * Friendly "you don't have access to this page" landing. Shown by the
 * route guard when an authenticated user navigates to a path their role
 * is not permitted to use (e.g. a BCeID submitter loading /search).
 *
 * <p>Distinct from {@link UnauthorizedPage}, which is for users whose
 * token carries no FSPTS role at all. This page is reached by users
 * with a valid role who simply don't have rights to the requested URL.
 * Same chrome / styling so the two look like siblings; the primary
 * action steers the user back into a page they CAN use rather than
 * just offering Sign Out.
 */
const ForbiddenPage: FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const logoSrc = theme === 'g100' ? '/bc-gov-logo-rev.png' : '/bc-gov-logo.png';

  const displayName =
    user?.displayName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.userName ||
    user?.providerUsername;

  const homeRoute = defaultRouteForUser(user);

  return (
    <div className="landing-grid-container">
      <Grid fullWidth className="landing-grid">
        <Column className="landing-content-col" sm={4} md={8} lg={8}>
          <div className="landing-content-wrapper">
            <div>
              <img src={logoSrc} alt="BC Government" width={160} className="logo" />
            </div>

            <h1 data-testid="forbidden-title" className="landing-title">
              You don't have access to view this page
            </h1>

            <h2 data-testid="forbidden-subtitle" className="landing-subtitle">
              {displayName
                ? `${displayName}, your account doesn't have permission to use this part of FSPTS.`
                : `Your account doesn't have permission to use this part of FSPTS.`}
            </h2>

            <div className="buttons-container single-row">
              <Button
                type="button"
                kind="primary"
                onClick={() => navigate(homeRoute)}
                renderIcon={ArrowRight}
                size="md"
                data-testid="forbidden-button__home"
                className="login-btn"
              >
                Go to my landing page
              </Button>
              <Button
                type="button"
                kind="tertiary"
                onClick={() => void logout()}
                renderIcon={Logout}
                size="md"
                data-testid="forbidden-button__logout"
                className="login-btn"
              >
                Sign out
              </Button>
            </div>
          </div>
        </Column>

        <Column className="landing-img-col" sm={4} md={8} lg={8}>
          <img src="/landing.jpg" alt="BC forest landscape" className="landing-img" />
        </Column>
      </Grid>
    </div>
  );
};

export default ForbiddenPage;
