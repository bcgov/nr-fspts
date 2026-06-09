package ca.bc.gov.nrs.fsp.api.submission.validator;

import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.PrecisionModel;
import org.locationtech.jts.operation.valid.IsValidOp;
import org.locationtech.jts.precision.GeometryPrecisionReducer;
import org.locationtech.jts.simplify.DouglasPeuckerSimplifier;
import org.locationtech.jts.simplify.TopologyPreservingSimplifier;
import org.springframework.stereotype.Component;

/**
 * Reduces submitted geometry to a BCGW-compatible storage form before
 * persistence. The spatial strategy referenced by FDS / VRI guidance:
 *
 * <ol>
 *   <li>Douglas-Peucker simplification at 2.5 m tolerance.</li>
 *   <li>Snap to a 0.001 m precision grid (BCGW storage precision).</li>
 *   <li>Re-validate; if invalid, fall back to topology-preserving
 *       simplification (slower, won't sliver-collapse rings).</li>
 *   <li>If the fallback also produces invalid geometry, fail loudly so
 *       the user knows their input was too detailed / fragile to
 *       simplify cleanly.</li>
 * </ol>
 *
 * <p>Input is expected to already be in EPSG:3005 (metres) — the
 * upstream {@link SrsValidator} reprojects 4326 → 3005 before this
 * runs. Tolerances expressed in metres only make sense in projected
 * units.
 */
@Component
@Slf4j
public class GeometrySimplifier {

  /** Douglas-Peucker tolerance in metres. Aligns with VRI / MSG guidance. */
  public static final double TOLERANCE_METRES = 2.5;

  /**
   * Fixed precision grid for BCGW storage. {@code scale=1000} → 1/1000
   * unit = 0.001 m. Anything past that is truncated.
   */
  private static final PrecisionModel STORAGE_PRECISION = new PrecisionModel(1000.0);

  /**
   * @return the simplified + snapped geometry. Topologically valid by
   *     construction (or this method throws).
   * @throws SimplificationException when neither Douglas-Peucker nor
   *     topology-preserving simplification produce a valid result.
   */
  public Geometry simplifyAndSnap(Geometry input) {
    if (input == null || input.isEmpty()) {
      throw new SimplificationException("input geometry is empty");
    }

    // Pass 1 — Douglas-Peucker. Fast and produces the cleanest output
    // when the input is well-shaped; can introduce sliver self-intersections
    // when rings are dense/twisty.
    Geometry simplified = DouglasPeuckerSimplifier.simplify(input, TOLERANCE_METRES);
    Geometry snapped = snap(simplified);
    if (isValid(snapped)) return snapped;

    log.debug("Douglas-Peucker output invalid after snap — falling back to "
        + "TopologyPreservingSimplifier ({} vertices in → {} after DP)",
        input.getNumPoints(), simplified.getNumPoints());

    // Pass 2 — topology-preserving. Slower but won't collapse rings.
    Geometry topoSimplified = TopologyPreservingSimplifier.simplify(input, TOLERANCE_METRES);
    Geometry topoSnapped = snap(topoSimplified);
    if (isValid(topoSnapped)) return topoSnapped;

    throw new SimplificationException(
        "geometry could not be simplified to a valid shape at "
            + TOLERANCE_METRES + " m tolerance — input may be too dense or "
            + "self-intersecting near the simplification threshold");
  }

  private static Geometry snap(Geometry geom) {
    return GeometryPrecisionReducer.reduce(geom, STORAGE_PRECISION);
  }

  private static boolean isValid(Geometry geom) {
    if (geom == null || geom.isEmpty()) return false;
    return new IsValidOp(geom).isValid();
  }

  /** Surfaced as a {@code SIMPLIFY_INVALID} validation error. */
  public static class SimplificationException extends RuntimeException {
    public SimplificationException(String message) {
      super(message);
    }
  }
}
