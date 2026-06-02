import {Column, Grid} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import './FspInformation/fsp-info.scss';

/**
 * Read-only placeholder for the "Extension Request" page. The legacy
 * page captured a proposed new term + expiry + supporting docs and
 * submitted via FSP_302_EXTENSION_REQUEST. View-only mode renders the
 * tile below describing the flow; the route remains so deep links
 * from the legacy app land somewhere intelligible.
 */
const ExtensionRequestPage: FC = () => {
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
            <h1>Extension Request — FSP {fspId || '—'}</h1>
          </div>
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Request a New Extension</h2>
          </header>
          <p>
            This page submits a new term + expiry extension for FSP{' '}
            <strong>{fspId || '—'}</strong>. The form collects new term in
            years/months, the proposed expiry date, supporting comments, and
            attachments; it submits through FSP_302_EXTENSION_REQUEST.
          </p>
          <p>
            <em>Write-mode is not enabled in this view-only build.</em> To see
            existing extensions on this FSP, open the{' '}
            <a
              href={`/fsp/extension-summary?fspId=${encodeURIComponent(fspId)}`}
            >
              Extension Summary
            </a>{' '}
            page.
          </p>
        </section>
      </Column>
    </Grid>
  );
};

export default ExtensionRequestPage;
