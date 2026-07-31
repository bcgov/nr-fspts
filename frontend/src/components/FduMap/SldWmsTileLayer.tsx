import {
  createElementObject,
  createTileLayerComponent,
  type LayerProps,
  updateGridLayer,
  withPane,
} from '@react-leaflet/core';
import { TileLayer, type WMSParams } from 'leaflet';

/**
 * A WMS tile layer that renders a caller-supplied SLD via `sld_body` — used
 * to draw province-wide FDU / BC Timber Sales labels the published styles
 * don't provide.
 *
 * <p>Why a bespoke layer instead of the stock react-leaflet `WMSTileLayer`:
 * BCGW's GeoServer only honours a custom `sld_body` when the GetMap request
 * carries NO `layers` param. Sending `layers=<name>&sld_body=…` makes it fall
 * back to the layer's published default style (our labels never appear), and
 * an empty `layers=` errors outright ("No LAYERS has been requested"). The
 * layer to draw is instead identified by the SLD's own
 * `<NamedLayer><Name>`. Leaflet's `TileLayer.WMS` always serialises
 * `layers=…`, so we subclass it and strip that one param from every tile URL.
 */
const SldWMS = TileLayer.WMS.extend({
  getTileUrl(coords: unknown): string {
    const url = (
      TileLayer.WMS.prototype.getTileUrl as (c: unknown) => string
    ).call(this, coords);
    // Remove `layers=<anything>` (Leaflet emits an empty `layers=` by
    // default); leave the surrounding `?`/`&` well-formed.
    return url.replace(/([?&])layers=[^&]*(&|$)/i, (_m, sep: string, tail: string) =>
      tail === '&' ? sep : '',
    );
  },
}) as unknown as typeof TileLayer.WMS;

export interface SldWmsTileLayerProps extends LayerProps {
  url: string;
  /**
   * WMS params. `layers` is intentionally unsupported (it's stripped) — pass
   * the target layer via the SLD's `<NamedLayer><Name>` and supply the SLD
   * through `sld_body`.
   */
  params?: Omit<WMSParams, 'layers'> & { sld_body?: string };
  zIndex?: number;
  opacity?: number;
}

export const SldWmsTileLayer = createTileLayerComponent<
  TileLayer.WMS,
  SldWmsTileLayerProps
>(
  ({ params = {}, url, ...options }, context) => {
    const layer = new SldWMS(url, {
      ...(params as object),
      ...withPane(options, context),
    });
    return createElementObject(layer, context);
  },
  (layer, props, prevProps) => {
    updateGridLayer(layer, props, prevProps);
    if (props.params != null && props.params !== prevProps.params) {
      layer.setParams(props.params as WMSParams);
    }
  },
);

export default SldWmsTileLayer;
