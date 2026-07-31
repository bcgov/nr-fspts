import { Login } from '@carbon/icons-react';
import { Button, Column, Grid, InlineNotification } from '@carbon/react';
import { type FC, useEffect, useState } from 'react';

import { Modal } from '@/components/Modal';
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
  const [requestAccessOpen, setRequestAccessOpen] = useState(false);
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

            <div className="landing-actions">
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

              <div className="landing-request-access">
                <button
                  type="button"
                  className="landing-request-access__link"
                  onClick={() => setRequestAccessOpen(true)}
                >
                  Request access to FSPTS
                </button>
                <p className="landing-request-access__note">
                  An active IDIR or Business BCeID account is required
                </p>
              </div>
            </div>
          </div>
        </Column>

        <Column className="landing-img-col" sm={4} md={8} lg={8}>
          <img src="/landing.jpg" alt="BC forest landscape" className="landing-img" />
        </Column>
      </Grid>

      <Modal
        open={requestAccessOpen}
        modalHeading="Request access to FSPTS"
        passiveModal
        size="sm"
        onRequestClose={() => setRequestAccessOpen(false)}
      >
        <div className="landing-request-modal">
          <p>
            To request access, email{' '}
            <a href="mailto:FSPTS.Admin@gov.bc.ca">FSPTS.Admin@gov.bc.ca</a> and
            include:
          </p>

          <p className="landing-request-modal__group-title">
            Business BCeID users
          </p>
          <ul>
            <li>Name</li>
            <li>Email address</li>
            <li>Company</li>
            <li>Phone number</li>
            <li>Business BCeID username</li>
            <li>Client numbers</li>
            <li>Requested roles — Submitter, Reviewer, or Approver</li>
          </ul>

          <p className="landing-request-modal__group-title">IDIR users</p>
          <ul>
            <li>First and last name, or IDIR username</li>
          </ul>
        </div>
      </Modal>
    </div>
  );
};

export default LandingPage;
