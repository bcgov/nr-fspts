import './fsp-map.scss';

import { Map } from '@carbon/icons-react';
import { type FC } from 'react';
import { useSearchParams } from 'react-router-dom';

import FduMap from '@/components/FduMap';

/**
 * Standalone, full-screen Leaflet view of an FSP's FDU boundaries — the
 * target of the per-row "Map view" links on the FSP detail's Map tab.
 * Opened in a new browser tab (window.open) so it behaves like the legacy
 * external map viewer did, but renders our own reprojected outlines instead
 * of handing off to arcmaps.
 *
 * <p>Reads {@code fspId} / {@code amendmentNumber} from the query string so
 * the link is a plain URL any tab can load. Kept intentionally chrome-free
 * (no app SideNav) — it's a focused map popup, not a navigational page.
 */
const FspMapPage: FC = () => {
  const [params] = useSearchParams();
  const fspId = params.get('fspId') ?? '';
  const amendmentNumber = params.get('amendmentNumber') ?? '0';

  return (
    <div className="fsp-map-page">
      <header className="fsp-map-page__header">
        <Map size={20} />
        <h1 className="fsp-map-page__title">
          FSP {fspId || '—'}
          <span className="fsp-map-page__subtitle">
            Forest Development Units
          </span>
        </h1>
      </header>
      <div className="fsp-map-page__body">
        {fspId ? (
          <FduMap
            fspId={fspId}
            amendmentNumber={amendmentNumber}
            height="100%"
            scrollWheelZoom
          />
        ) : (
          <p className="fsp-map-page__empty">
            No FSP specified for this map view.
          </p>
        )}
      </div>
    </div>
  );
};

export default FspMapPage;
