import { Login } from '@carbon/icons-react';
import { Button, Column, Grid, InlineNotification } from '@carbon/react';
import { type FC, useEffect, useState } from 'react';

import { SESSION_EXPIRED_FLAG } from '@/components/SessionTimeout';
import { useAuth } from '@/context/auth/useAuth';
import { useTheme } from '@/context/theme/useTheme';

import './LandingPage.scss';

const LandingPage: FC = () => {
  const { theme } = useTheme();
  const { login } = useAuth();
  const logoSrc = theme === 'g100' ? '/bc-gov-logo-rev.png' : '/bc-gov-logo.png';

  // Show the "session expired" notice once, when we land here via an
  // inactivity logout (SessionTimeout sets the flag before signing out).
  // Read-and-clear so a manual page refresh doesn't resurface it.
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_FLAG) === '1') {
        setSessionExpired(true);
        sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
      }
    } catch {
      /* storage unavailable — just don't show the notice */
    }
  }, []);

  return (
    <div className="landing-grid-container">
      <Grid fullWidth className="landing-grid">
        <Column className="landing-content-col" sm={4} md={8} lg={8}>
          <div className="landing-content-wrapper">
            <div>
              <img src={logoSrc} alt="BC Government" width={160} className="logo" />
            </div>

            <h1 data-testid="landing-title" className="landing-title">
              FSPTS
            </h1>

            <h2 data-testid="landing-subtitle" className="landing-subtitle">
              Forest Stewardship Plan Tracking System
            </h2>

            {sessionExpired && (
              <InlineNotification
                kind="warning"
                lowContrast
                className="landing-session-expired"
                data-testid="landing-session-expired"
                title="You've been logged out"
                subtitle="Your session expired for security reasons and any unsaved changes were lost. Log in again to continue."
                onClose={() => setSessionExpired(false)}
              />
            )}

            <div className="buttons-container single-row">
              <Button
                type="button"
                onClick={() => login('idir')}
                renderIcon={Login}
                size="md"
                data-testid="landing-button__idir"
                className="login-btn"
              >
                Log in with IDIR
              </Button>

              <Button
                type="button"
                kind="tertiary"
                onClick={() => login('bceid')}
                renderIcon={Login}
                size="md"
                data-testid="landing-button__bceid"
                className="login-btn"
              >
                Log in with Business BCeID
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

export default LandingPage;
