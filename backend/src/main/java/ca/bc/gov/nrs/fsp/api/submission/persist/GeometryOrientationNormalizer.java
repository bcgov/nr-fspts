package ca.bc.gov.nrs.fsp.api.submission.persist;

import org.locationtech.jts.algorithm.Orientation;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LinearRing;
import org.locationtech.jts.geom.MultiPolygon;
import org.locationtech.jts.geom.Polygon;

/**
 * Forces every {@link Polygon} ring in a JTS {@link Geometry} into the
 * orientation Oracle Spatial requires: exterior rings counter-clockwise
 * (CCW), interior rings (holes) clockwise (CW). This matches OGC
 * Simple Features and GeoJSON RFC 7946, but Oracle's
 * {@code MOF_SPATIAL_VALIDATION} trigger ({@code FSP_FDUG_MCT_TRG} on
 * {@code FOREST_DEVELOPMENT_UNIT_GEOM}) raises {@code ORA-13367}
 * whenever a ring comes in with the wrong winding.
 *
 * <p>The GML / GeoJSON parsers in this codebase preserve whatever
 * winding the source file uses — many ESRI exports and older GeoJSON
 * producers emit CW exterior rings, which Oracle then rejects. Run
 * every geometry through this normalizer just before WKT generation
 * to make orientation a non-issue.
 *
 * <p>Non-polygon geometries (Point, LineString, etc.) are returned
 * unchanged.
 */
public final class GeometryOrientationNormalizer {

  private GeometryOrientationNormalizer() {}

  public static Geometry normalize(Geometry input) {
    if (input == null) return null;
    if (input instanceof Polygon p) return rewindPolygon(p);
    if (input instanceof MultiPolygon mp) return rewindMultiPolygon(mp);
    // Other geometry types don't have ring orientation — return as-is.
    return input;
  }

  private static MultiPolygon rewindMultiPolygon(MultiPolygon mp) {
    GeometryFactory gf = mp.getFactory();
    Polygon[] rewound = new Polygon[mp.getNumGeometries()];
    boolean changed = false;
    for (int i = 0; i < rewound.length; i++) {
      Polygon original = (Polygon) mp.getGeometryN(i);
      Polygon fixed = rewindPolygon(original);
      rewound[i] = fixed;
      if (fixed != original) changed = true;
    }
    return changed ? gf.createMultiPolygon(rewound) : mp;
  }

  private static Polygon rewindPolygon(Polygon polygon) {
    GeometryFactory gf = polygon.getFactory();
    LinearRing shell = polygon.getExteriorRing();
    LinearRing fixedShell = ensureOrientation(shell, /* wantCcw */ true, gf);

    int holeCount = polygon.getNumInteriorRing();
    LinearRing[] fixedHoles = new LinearRing[holeCount];
    boolean changed = fixedShell != shell;
    for (int i = 0; i < holeCount; i++) {
      LinearRing hole = polygon.getInteriorRingN(i);
      LinearRing fixedHole = ensureOrientation(hole, /* wantCcw */ false, gf);
      fixedHoles[i] = fixedHole;
      if (fixedHole != hole) changed = true;
    }
    return changed ? gf.createPolygon(fixedShell, fixedHoles) : polygon;
  }

  /**
   * Returns the input ring if it already matches the desired
   * orientation; otherwise returns a reversed copy. {@code wantCcw=true}
   * means exterior ring (CCW); {@code wantCcw=false} means hole (CW).
   */
  private static LinearRing ensureOrientation(LinearRing ring, boolean wantCcw, GeometryFactory gf) {
    boolean isCcw = Orientation.isCCW(ring.getCoordinateSequence());
    if (isCcw == wantCcw) return ring;
    return ring.reverse();
  }
}
