import {Column, Grid} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import './FspInformation/fsp-info.scss';

/**
 * Read-only placeholder for the legacy "Amend Information" page. The
 * underlying flow is a write operation (initiate an amendment on this
 * FSP), so a view-only mode doesn't render meaningful data yet. The
 * tile here describes what the action will do once write/edit support
 * lands; the route still resolves so existing deep links don't 404.
 */
const AmendInformationPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fspId = searchParams.get('fspId') ?? '';

  const backToFsp = () => {
    if (fspId) {
      navigate(`/fsp/information?fspId=${encodeURIComponent(fspId)}`);
    } else {
      navigate('/search');
    }
  };

  return (
    <Grid fullWidth className="default-grid fsp-info-grid">
      <Column sm={4} md={8} lg={16}>
        <button type="button" className="fsp-info__back" onClick={backToFsp}>
          <ArrowLeft size={16} /> Back to FSP {fspId || 'search'}
        </button>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <header className="fsp-info__header">
          <div className="fsp-info__header-title">
            <h1>Amend Information — FSP {fspId || '—'}</h1>
          </div>
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Amendment Workflow</h2>
          </header>
          <p>
            This page initiates an amendment to FSP <strong>{fspId || '—'}</strong>.
            The amendment workflow captures which sections (FDU, identified areas,
            stocking standards) change, whether DDM approval is required, and a
            summary of the proposed changes.
          </p>
          <p>
            <em>Write-mode is not enabled in this view-only build.</em> Once
            edit-mode lands, the form will appear here and submit through
            FSP_300_INFORMATION (action <code>AMEND</code>).
          </p>
        </section>
      </Column>
    </Grid>
  );
};

export default AmendInformationPage;
