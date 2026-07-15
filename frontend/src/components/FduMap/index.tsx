import 'leaflet/dist/leaflet.css';
import './fdu-map.scss';

import { Loading } from '@carbon/react';
import L from 'leaflet';
import { useEffect, useState, type FC } from 'react';
import {
  GeoJSON,
  LayersControl,
  MapContainer,
  TileLayer,
  useMap,
  ZoomControl,
} from 'react-leaflet';

import { getFspFduGeometry } from '@/services/fspSearch';

/**
 * Embedded Leaflet map of an FSP's FDU polygons — replaces the legacy
 * hand-off to the external arcmaps viewer. Mirrors nr-silva's OpeningsMap
 * pattern (ESRI base layers + a GeoJSON overlay + fit-to-bounds), scaled
 * down to our single use: draw the FDU outlines and frame them.
 *
 * <p>The polygons come from the backend already reprojected to WGS84, so
 * this component stays dumb — it renders the FeatureCollection and fits
 * the view to it.
 */
interface Props {
  fspId: string;
  amendmentNumber: string;
  /**
   * Map height. A number is treated as pixels; pass "100%" to fill a
   * flex/grid parent (used by the standalone full-page map view).
   */
  height?: number | string;
  /** Parent-bumped counter that forces a refetch on Submit/Extend/etc. */
  refreshKey?: number;
  /**
   * Enable mouse-wheel zoom. Off by default so an embedded map doesn't
   * hijack page scroll; the full-page map view turns it on.
   */
  scrollWheelZoom?: boolean;
}

// FDU outline styling — a solid blue stroke with a light translucent fill,
// legible over both the topographic and satellite basemaps.
const FDU_STYLE: L.PathOptions = {
  color: '#0f62fe',
  weight: 2,
  opacity: 1,
  fillColor: '#4589ff',
  fillOpacity: 0.25,
};

// Frame the map to the FDU polygons whenever they change.
const FitBounds: FC<{ data: GeoJSON.FeatureCollection | null }> = ({ data }) => {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
  }, [data, map]);
  return null;
};

// Leaflet renders grey when its container was hidden at mount (which is the
// case inside a Carbon TabPanel that wasn't the initially-selected tab).
// Invalidate the size once mounted so tiles lay out correctly.
const ResizeFix: FC<{ height: number }> = ({ height }) => {
  const map = useMap();
  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [map, height]);
  return null;
};

const FduMap: FC<Props> = ({
  fspId,
  amendmentNumber,
  height = 480,
  refreshKey,
  scrollWheelZoom = false,
}) => {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspFduGeometry(fspId, amendmentNumber || '0')
      .then((fc) => {
        if (!cancelled) setData(fc);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Map load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, amendmentNumber, refreshKey]);

  const hasFeatures = !!data?.features?.length;
  // New FeatureCollection identity per fetch — key the GeoJSON layer so it
  // re-renders when the data changes (react-leaflet caches it otherwise).
  const dataKey = `${fspId}-${amendmentNumber}-${refreshKey ?? 0}-${data?.features?.length ?? 0}`;

  return (
    <div className="fdu-map" style={{ height }}>
      {loading && (
        <div className="fdu-map__overlay" role="status" aria-live="polite">
          <Loading small withOverlay={false} description="Loading map…" />
        </div>
      )}
      {!loading && error && (
        <div className="fdu-map__overlay fdu-map__overlay--msg">{error}</div>
      )}
      {!loading && !error && !hasFeatures && (
        <div className="fdu-map__overlay fdu-map__overlay--msg">
          No FDU geometry to display for this version.
        </div>
      )}

      <MapContainer
        // Default view over BC; FitBounds reframes once features load.
        center={[54.5, -125]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        scrollWheelZoom={scrollWheelZoom}
      >
        <ZoomControl position="bottomright" />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Topographic">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {hasFeatures && (
          <GeoJSON key={dataKey} data={data} style={() => FDU_STYLE} />
        )}
        <FitBounds data={data} />
        <ResizeFix height={height} />
      </MapContainer>
    </div>
  );
};

export default FduMap;
