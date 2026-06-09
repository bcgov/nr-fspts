package ca.bc.gov.nrs.fsp.api.submission.validator;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.prep.PreparedGeometry;
import org.locationtech.jts.geom.prep.PreparedGeometryFactory;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.WKTReader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Containment check against the BC provincial boundary. Loads a
 * generalized BC polygon from {@code bc-boundary-3005.wkt} at startup
 * and builds a {@link PreparedGeometry} for fast covers() checks.
 *
 * <p>Input geometries are expected to already be in EPSG:3005 (the
 * upstream {@link SrsValidator} handles reprojection from 4326 / 42102
 * → 3005), so all coordinates compared here share the same metric
 * coordinate space.
 *
 * <p>The bundled boundary is a placeholder — see the WKT resource's
 * header comments for the swap-with-BCGW guidance.
 */
@Component
@Slf4j
public class BcBoundaryValidator {

  private static final String RESOURCE = "bc-boundary-3005.wkt";

  private PreparedGeometry bcOutline;

  @PostConstruct
  void loadBoundary() {
    try {
      String raw = new String(
          new ClassPathResource(RESOURCE).getInputStream().readAllBytes(),
          StandardCharsets.UTF_8);
      // Strip '#'-prefix comment lines + blank lines so the WKT reader
      // sees only the geometry literal.
      String wkt = Arrays.stream(raw.split("\\R"))
          .map(String::trim)
          .filter(s -> !s.isEmpty() && !s.startsWith("#"))
          .collect(Collectors.joining(" "));
      Geometry geom = new WKTReader().read(wkt);
      this.bcOutline = PreparedGeometryFactory.prepare(geom);
      log.info("Loaded BC boundary ({} vertices, area={} m²)",
          geom.getNumPoints(), geom.getArea());
    } catch (IOException | ParseException e) {
      throw new IllegalStateException(
          "Failed to load BC boundary resource " + RESOURCE, e);
    }
  }

  /**
   * @param geom geometry in EPSG:3005 to test for containment.
   * @return true when the entire geometry lies inside the BC outline.
   *     Uses {@code covers} (boundary-inclusive) so polygons exactly
   *     along the BC border still pass.
   */
  public boolean isInsideBc(Geometry geom) {
    if (geom == null || geom.isEmpty()) return false;
    return bcOutline.covers(geom);
  }
}
