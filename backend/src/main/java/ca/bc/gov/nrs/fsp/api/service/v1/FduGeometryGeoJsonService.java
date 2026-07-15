package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduGeometryDao;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.sql.Struct;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Decodes the FDU {@code SDO_GEOMETRY} polygons for an FSP + amendment
 * into a WGS84 GeoJSON FeatureCollection for the Leaflet map. Reuses the
 * same data source as {@link FspExtentService} ({@code
 * FSP_COMMON.fdu_geometry_gets}) but keeps the full ring geometry instead
 * of collapsing to a bounding box, and reprojects each vertex from the
 * storage CRS (BC Albers, EPSG:3005) to WGS84 (EPSG:4326) so Leaflet can
 * render it directly — the frontend never sees Albers coordinates.
 *
 * <p>Handles the geometry shapes FDUs actually use: 2D polygons and
 * multipolygons with linear ({@code interpretation = 1}) or optimized-
 * rectangle ({@code interpretation = 3}) rings, including interior rings
 * (holes). Arc-based rings are not expected for digitized FDU boundaries
 * and are skipped defensively rather than mis-rendered.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FduGeometryGeoJsonService {

  // SDO_GEOMETRY attribute indices (see FspExtentService for the full map).
  private static final int ATTR_GTYPE = 0;
  private static final int ATTR_ELEM_INFO = 3;
  private static final int ATTR_ORDINATES = 4;

  // BC Albers (EPSG:3005) — the CRS BC-gov spatial data (and the legacy
  // arcmaps extent) uses. Defined by proj string so we don't need the
  // proj4j EPSG-registry jar.
  private static final String SRC_ALBERS =
      "+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 "
          + "+x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs";
  private static final String DST_WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

  private final FduGeometryDao fduGeometryDao;

  /**
   * @return a GeoJSON FeatureCollection (as nested maps/lists for Jackson)
   *     with one Feature per FDU; an empty collection when the FSP /
   *     amendment has no FDU geometry.
   */
  public Map<String, Object> getFeatureCollection(int fspId, int amendmentNumber) {
    // proj4j's BasicCoordinateTransform isn't thread-safe, so build a fresh
    // transform per request rather than sharing one across map loads.
    CoordinateTransform transform = newAlbersToWgs84();

    List<Object> features = new ArrayList<>();
    int index = 0;
    for (FduGeometryDao.FduGeometryRow row : fduGeometryDao.getFduGeometry(fspId, amendmentNumber)) {
      Object first = row.columns().values().stream().findFirst().orElse(null);
      if (!(first instanceof Struct geom)) continue;

      Object geometry = toGeoJsonGeometry(geom, transform);
      if (geometry == null) continue;

      Map<String, Object> properties = new LinkedHashMap<>(1);
      properties.put("index", index);

      Map<String, Object> feature = new LinkedHashMap<>(4);
      feature.put("type", "Feature");
      feature.put("id", index);
      feature.put("properties", properties);
      feature.put("geometry", geometry);
      features.add(feature);
      index++;
    }

    Map<String, Object> collection = new LinkedHashMap<>(2);
    collection.put("type", "FeatureCollection");
    collection.put("features", features);
    return collection;
  }

  private static CoordinateTransform newAlbersToWgs84() {
    CRSFactory crsFactory = new CRSFactory();
    CoordinateReferenceSystem src = crsFactory.createFromParameters("EPSG:3005", SRC_ALBERS);
    CoordinateReferenceSystem dst = crsFactory.createFromParameters("EPSG:4326", DST_WGS84);
    return new CoordinateTransformFactory().createTransform(src, dst);
  }

  /**
   * Decode one SDO_GEOMETRY into a GeoJSON geometry (Polygon or
   * MultiPolygon), reprojecting every vertex to WGS84. Returns null when
   * the geometry is empty or can't be decoded.
   */
  private Object toGeoJsonGeometry(Struct geom, CoordinateTransform transform) {
    try {
      Object[] attrs = geom.getAttributes();
      if (attrs == null || attrs.length <= ATTR_ORDINATES) return null;

      int dim = inferDimension(attrs[ATTR_GTYPE]);
      double[] ords = toDoubleArray(attrs[ATTR_ORDINATES]);
      int[] elemInfo = toIntArray(attrs[ATTR_ELEM_INFO]);
      if (ords == null || ords.length < 2 || elemInfo == null || elemInfo.length < 3) {
        return null;
      }

      // Walk the SDO_ELEM_INFO triplets, slicing SDO_ORDINATES into rings.
      // An exterior ring (etype 1003) starts a new polygon; interior rings
      // (etype 2003) become holes on the current polygon.
      List<List<Object>> polygons = new ArrayList<>();
      List<Object> currentPolygon = null;

      for (int t = 0; t + 2 < elemInfo.length; t += 3) {
        int startOffset = elemInfo[t] - 1;               // 1-based → 0-based
        int etype = elemInfo[t + 1];
        int interpretation = elemInfo[t + 2];
        int endOffset =
            (t + 3 < elemInfo.length) ? elemInfo[t + 3] - 1 : ords.length; // exclusive

        if (etype != 1003 && etype != 2003) continue;    // skip non-polygon elements

        List<Object> ring =
            interpretation == 3
                ? rectangleRing(ords, startOffset, endOffset, dim, transform)
                : linearRing(ords, startOffset, endOffset, dim, transform);
        if (ring == null || ring.isEmpty()) continue;

        if (etype == 1003) {
          currentPolygon = new ArrayList<>();
          currentPolygon.add(ring);
          polygons.add(currentPolygon);
        } else if (currentPolygon != null) {
          currentPolygon.add(ring);                      // hole on current polygon
        }
      }

      if (polygons.isEmpty()) return null;

      Map<String, Object> out = new LinkedHashMap<>(2);
      if (polygons.size() == 1) {
        out.put("type", "Polygon");
        out.put("coordinates", polygons.get(0));
      } else {
        out.put("type", "MultiPolygon");
        out.put("coordinates", polygons);
      }
      return out;
    } catch (SQLException ex) {
      log.warn("Skipping FDU SDO_GEOMETRY — failed to decode", ex);
      return null;
    }
  }

  /** Linear ring: (x,y) pairs stepping by the geometry dimension. */
  private static List<Object> linearRing(
      double[] ords, int start, int end, int dim, CoordinateTransform transform) {
    List<Object> ring = new ArrayList<>();
    for (int i = start; i + 1 < end && i + 1 < ords.length; i += dim) {
      ring.add(project(ords[i], ords[i + 1], transform));
    }
    if (ring.size() < 4) return null;                    // GeoJSON rings need ≥4 points
    ensureClosed(ring);
    return ring;
  }

  /**
   * Optimized-rectangle ring: two corner points (lower-left, upper-right)
   * expanded into an explicit 5-point closed ring.
   */
  private static List<Object> rectangleRing(
      double[] ords, int start, int end, int dim, CoordinateTransform transform) {
    if (start + 3 >= ords.length || start + 3 >= end) return null;
    double minX = ords[start];
    double minY = ords[start + 1];
    double maxX = ords[start + dim];
    double maxY = ords[start + dim + 1];
    List<Object> ring = new ArrayList<>(5);
    ring.add(project(minX, minY, transform));
    ring.add(project(maxX, minY, transform));
    ring.add(project(maxX, maxY, transform));
    ring.add(project(minX, maxY, transform));
    ring.add(project(minX, minY, transform));
    return ring;
  }

  /** Reproject one Albers vertex to a GeoJSON [lng, lat] pair. */
  private static List<Double> project(double x, double y, CoordinateTransform transform) {
    ProjCoordinate out = new ProjCoordinate();
    transform.transform(new ProjCoordinate(x, y), out);
    return List.of(out.x, out.y);
  }

  /** GeoJSON polygon rings must be closed (first point == last point). */
  private static void ensureClosed(List<Object> ring) {
    Object first = ring.get(0);
    Object last = ring.get(ring.size() - 1);
    if (!first.equals(last)) ring.add(first);
  }

  private static int inferDimension(Object gtype) {
    if (gtype instanceof Number n) {
      int d = Math.abs(n.intValue()) / 1000;
      if (d >= 2 && d <= 4) return d;
    }
    return 2;
  }

  private static double[] toDoubleArray(Object sqlArray) throws SQLException {
    if (!(sqlArray instanceof java.sql.Array arr)) return null;
    Object raw;
    try {
      raw = arr.getArray();
    } finally {
      arr.free();
    }
    int len = java.lang.reflect.Array.getLength(raw);
    double[] out = new double[len];
    for (int i = 0; i < len; i++) {
      Object v = java.lang.reflect.Array.get(raw, i);
      out[i] = (v instanceof Number n) ? n.doubleValue() : 0d;
    }
    return out;
  }

  private static int[] toIntArray(Object sqlArray) throws SQLException {
    if (!(sqlArray instanceof java.sql.Array arr)) return null;
    Object raw;
    try {
      raw = arr.getArray();
    } finally {
      arr.free();
    }
    int len = java.lang.reflect.Array.getLength(raw);
    int[] out = new int[len];
    for (int i = 0; i < len; i++) {
      Object v = java.lang.reflect.Array.get(raw, i);
      out[i] = (v instanceof Number n) ? n.intValue() : 0;
    }
    return out;
  }
}
