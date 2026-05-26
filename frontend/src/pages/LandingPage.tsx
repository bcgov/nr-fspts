import { Login } from '@carbon/icons-react';
import { Button, Column, Grid } from '@carbon/react';
import type { FC } from 'react';

import { startLogin } from '@/auth/auth';
import { useTheme } from '@/context/theme/useTheme';

import './LandingPage.scss';

const AUTH_IDP_IDIR  = import.meta.env.VITE_AUTH_IDP_IDIR;
const AUTH_IDP_BCEID = import.meta.env.VITE_AUTH_IDP_BCEID;

const LandingPage: FC = () => {
  const { theme } = useTheme();
  const logoSrc = theme === 'g100' ? '/bc-gov-logo-rev.png' : '/bc-gov-logo.png';

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

            <div className="buttons-container two-rows">
              <Button
                type="button"
                onClick={() => startLogin(AUTH_IDP_IDIR)}
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
                onClick={() => startLogin(AUTH_IDP_BCEID)}
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
