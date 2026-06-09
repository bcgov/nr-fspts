import {
  Button,
  Column,
  Grid,
  Loading,
  RadioButton,
  RadioButtonGroup,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/context/auth/useAuth';
import { useOrg } from '@/context/org/useOrg';
import { useTheme } from '@/context/theme/useTheme';
import { searchClients } from '@/services/clientSearch';

// Reuses the Landing/Unauthorized split-screen stylesheet so all three
// pre-app screens share the same logo + content / forest-image right
// side treatment.
import './LandingPage.scss';

interface OrgRow {
  clientNumber: string;
  /** Display label — name when we manage to fetch it, "Client #…" otherwise. */
  label: string;
}

const buildFallbackLabel = (cn: string) => `Client #${cn}`;

/**
 * Post-login page for BCeID users who carry FSPTS_SUBMITTER scopes for
 * more than one forest-client number. Forces an explicit pick so every
 * downstream API call has an unambiguous org context (the active client
 * number flows via the X-FSPTS-Active-Org-Client-Number header). Once
 * chosen, the user is redirected back to the SPA's normal landing.
 *
 * <p>Single-org BCeID users and IDIR users never see this page — they
 * land on the post-login redirect directly (handled in App.tsx).
 */
const OrgSelectionPage: FC = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const {
    availableOrgClientNumbers,
    activeOrgClientNumber,
    setActiveOrgClientNumber,
  } = useOrg();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [selected, setSelected] = useState<string>(
    activeOrgClientNumber ?? availableOrgClientNumbers[0] ?? '',
  );
  const [loading, setLoading] = useState(false);

  const logoSrc = theme === 'g100' ? '/bc-gov-logo-rev.png' : '/bc-gov-logo.png';

  // Enrich each client number with its forest-client name in parallel.
  // searchClients takes pClientNumber as one of its filters; the cursor
  // returns ≥1 row per client (one per location). We take row 0 — the
  // name is identical across locations.
  useEffect(() => {
    if (availableOrgClientNumbers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      availableOrgClientNumbers.map(async (cn): Promise<OrgRow> => {
        try {
          const res = await searchClients({ clientNumber: cn, size: 1 });
          const r = res.content[0];
          return {
            clientNumber: cn,
            label: r?.clientName
              ? `${r.clientName.trim()} (${cn})`
              : buildFallbackLabel(cn),
          };
        } catch {
          return { clientNumber: cn, label: buildFallbackLabel(cn) };
        }
      }),
    )
      .then((enriched) => {
        if (!cancelled) setRows(enriched);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [availableOrgClientNumbers]);

  const onContinue = () => {
    if (!selected) return;
    setActiveOrgClientNumber(selected);
    navigate('/data-submission', { replace: true });
  };

  return (
    <div className="landing-grid-container">
      <Grid fullWidth className="landing-grid">
        <Column className="landing-content-col" sm={4} md={8} lg={8}>
          {/* Custom inline layout instead of the landing-content-wrapper +
              landing-title/subtitle classes — those are sized for the
              hero Login/Unauthorized screens (fluid-display-01) and
              swamp this page, which has additional form content below.
              Plain elements with explicit spacing keep the title +
              subtitle proportional and give the Continue button enough
              breathing room from the radio list. */}
          <div
            style={{
              // Top-padded rather than vertically centered — keeps the
              // logo + title sitting near the top of the panel like a
              // standard form page, rather than floating mid-screen.
              padding: '4rem 2rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '2rem',
              maxWidth: '32rem',
            }}
          >
            <img src={logoSrc} alt="BC Government" width={140} className="logo" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600 }}>
                Select organization
              </h1>
              <p style={{ margin: 0, color: 'var(--cds-text-secondary)' }}>
                {user?.displayName ? `${user.displayName} — y` : 'Y'}ou are
                registered as a submitter for more than one forest-client
                organization. Pick which one you want to work under for this
                session. You can sign out and back in to switch later.
              </p>
            </div>

            {loading && (
              <div role="status" aria-live="polite">
                <Loading
                  description="Loading organizations…"
                  withOverlay={false}
                  small
                />
              </div>
            )}

            {/* Group the radio list and the Continue button into a
                tight stack so they read as one decision unit, while the
                outer container's 2rem gap still separates that unit
                from the title block above. */}
            {rows && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <RadioButtonGroup
                  legendText="Organization"
                  name="org-pick"
                  valueSelected={selected}
                  orientation="vertical"
                  onChange={(v) => setSelected(String(v))}
                >
                  {rows.map((r) => (
                    <RadioButton
                      key={r.clientNumber}
                      id={`org-pick-${r.clientNumber}`}
                      labelText={r.label}
                      value={r.clientNumber}
                    />
                  ))}
                </RadioButtonGroup>

                <div>
                  <Button
                    type="button"
                    onClick={onContinue}
                    size="md"
                    data-testid="org-select-button__continue"
                    disabled={!selected}
                    style={{ minWidth: '12rem' }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Column>

        <Column className="landing-img-col" sm={4} md={8} lg={8}>
          <img src="/landing.jpg" alt="BC forest landscape" className="landing-img" />
        </Column>
      </Grid>
    </div>
  );
};

export default OrgSelectionPage;
