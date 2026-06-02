import {Column, Grid} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import './FspInformation/fsp-info.scss';

/**
 * Read-only placeholder for the legacy "Replacement Information" page.
 * A replacement creates a new amendment with code <code>RPL</code> on
 * the existing FSP. View-only mode renders the descriptive tile here;
 * write support lands with the broader edit-mode work.
 */
const ReplaceInformationPage: FC = () => {
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
            <h1>Replacement Information — FSP {fspId || '—'}</h1>
          </div>
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Replacement Amendment</h2>
          </header>
          <p>
            This page initiates a replacement-type amendment for FSP{' '}
            <strong>{fspId || '—'}</strong>. Replacements are amendments with
            code <code>RPL</code> — they supersede the existing plan with a new
            one, capturing which sections (FDU, identified areas, stocking
            standards) change and a summary of those changes.
          </p>
          <p>
            <em>Write-mode is not enabled in this view-only build.</em> The form
            will land here once edit-mode is wired through
            FSP_300_INFORMATION (action <code>REPLACE</code>).
          </p>
        </section>
      </Column>
    </Grid>
  );
};

export default ReplaceInformationPage;
