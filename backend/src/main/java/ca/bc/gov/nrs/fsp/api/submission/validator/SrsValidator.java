package ca.bc.gov.nrs.fsp.api.submission.validator;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.CoordinateSequenceFilter;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;

/**
 * Single source of truth for what spatial reference systems we accept
 * on submission inputs, and how we normalize them to the canonical
 * storage CRS (BC Albers, EPSG:3005).
 *
 * <h3>Allowlist</h3>
 * <ul>
 *   <li><b>3005</b> — NAD83 / BC Albers, canonical storage CRS.</li>
 *   <li><b>42102</b> — legacy alias for 3005 (same projection, old EPSG code).
 *       Remapped to 3005 with no coordinate change.</li>
 *   <li><b>4326</b> — WGS 84 lat/lon. Coordinates reprojected to 3005 on the way in.</li>
 * </ul>
 *
 * <p>Anything else gets rejected with {@link UnsupportedSrsException}
 * so the user sees a clean upfront error instead of an opaque
 * ORA-13199 from the spatial trigger after persistence has started.
 */
@Component
@Slf4j
public class SrsValidator {

  /** EPSG code we ultimately write to Oracle. */
  public static final int TARGET_SRID = 3005;

  /** Legacy EPSG codes that alias the target CRS — same projection, no remap. */
  private static final Map<Integer, Integer> ALIASES = Map.of(
      42102, 3005
  );

  /** EPSG codes the validator accepts (post-alias resolution). */
  private static final Set<Integer> SUPPORTED = Set.of(3005, 4326);

  private final CRSFactory crsFactory = new CRSFactory();
  private final CoordinateTransformFactory transformFactory = new CoordinateTransformFactory();
  private CoordinateTransform wgs84ToAlbers;

  @PostConstruct
  void initTransforms() {
    CoordinateReferenceSystem wgs84 = crsFactory.createFromName("EPSG:4326");
    CoordinateReferenceSystem albers = crsFactory.createFromName("EPSG:3005");
    this.wgs84ToAlbers = transformFactory.createTransform(wgs84, albers);
    log.info("Initialized SRS transform 4326 → 3005 (BC Albers)");
  }

  /**
   * Resolves an alias and validates the result is on the allowlist.
   *
   * @param rawSrid the EPSG code as the user supplied it.
   * @return the canonical SRID — same value for 3005/4326, mapped to 3005 for 42102.
   * @throws UnsupportedSrsException if the code isn't on the allowlist.
   */
  public int resolve(int rawSrid) {
    int resolved = ALIASES.getOrDefault(rawSrid, rawSrid);
    if (!SUPPORTED.contains(resolved)) {
      throw new UnsupportedSrsException(rawSrid, resolved, SUPPORTED);
    }
    return resolved;
  }

  /**
   * Returns the geometry projected into {@value #TARGET_SRID}. No-op when
   * the input is already in 3005. WGS84 inputs are reprojected
   * coordinate-by-coordinate via proj4j.
   *
   * @param geom geometry tagged with {@code resolvedSrid}.
   * @param resolvedSrid the EPSG code returned by {@link #resolve(int)}.
   */
  public Geometry reproject(Geometry geom, int resolvedSrid) {
    if (resolvedSrid == TARGET_SRID) return geom;
    if (resolvedSrid == 4326) {
      Geometry copy = geom.copy();
      copy.apply(new Wgs84ToAlbersFilter(wgs84ToAlbers));
      copy.geometryChanged();
      return copy;
    }
    // Shouldn't reach here — resolve() would have rejected anything else.
    throw new UnsupportedSrsException(resolvedSrid, resolvedSrid, SUPPORTED);
  }

  /** Coord-by-coord reprojection. proj4j is thread-safe per transform. */
  private static final class Wgs84ToAlbersFilter implements CoordinateSequenceFilter {
    private final CoordinateTransform transform;
    private final ProjCoordinate src = new ProjCoordinate();
    private final ProjCoordinate dst = new ProjCoordinate();

    Wgs84ToAlbersFilter(CoordinateTransform transform) {
      this.transform = transform;
    }

    @Override
    public void filter(org.locationtech.jts.geom.CoordinateSequence seq, int i) {
      Coordinate c = seq.getCoordinate(i);
      src.x = c.x;
      src.y = c.y;
      transform.transform(src, dst);
      seq.setOrdinate(i, 0, dst.x);
      seq.setOrdinate(i, 1, dst.y);
    }

    @Override
    public boolean isDone() {
      return false;
    }

    @Override
    public boolean isGeometryChanged() {
      return true;
    }
  }

  /** Thrown when the submitted srsName isn't on the allowlist. */
  public static class UnsupportedSrsException extends RuntimeException {
    private final int rawSrid;
    private final int resolvedSrid;

    public UnsupportedSrsException(int rawSrid, int resolvedSrid, Set<Integer> supported) {
      super("EPSG:" + rawSrid
          + (rawSrid == resolvedSrid ? "" : " (resolves to " + resolvedSrid + ")")
          + " is not supported. Accepted: " + supported + " (with 42102 → 3005)");
      this.rawSrid = rawSrid;
      this.resolvedSrid = resolvedSrid;
    }

    public int rawSrid() { return rawSrid; }
    public int resolvedSrid() { return resolvedSrid; }
  }
}
