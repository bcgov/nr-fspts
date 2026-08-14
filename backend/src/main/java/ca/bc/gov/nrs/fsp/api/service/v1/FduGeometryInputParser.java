package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.submission.validator.SrsValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LinearRing;
import org.locationtech.jts.geom.MultiPolygon;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.WKTReader;
import org.locationtech.jts.operation.valid.IsValidOp;
import org.locationtech.jts.operation.valid.TopologyValidationError;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns the boundary a user pastes into the "Add FDU" dialog into a JTS
 * geometry ready for {@code FduWriteDao.insertFduGeometry}.
 *
 * <p>The submission pipeline reaches JTS by a different road — GeoJSON is
 * converted to GML by {@code SubmissionGeoJsonParser} and then to JTS by
 * {@code GmlGeometryConverter} — because it has a whole GML-shaped submission
 * to build. A single pasted polygon doesn't, so this reads GeoJSON straight
 * into JTS and also accepts WKT, which is what people tend to have on hand
 * from a GIS.
 *
 * <p>Everything downstream of the parse is shared with the submission path:
 * {@link SrsValidator} for projection, {@code IsValidOp} for topology, and
 * {@code GeometryOrientationNormalizer} at the call site.
 *
 * <p>Accepted GeoJSON shapes: a bare {@code Polygon}/{@code MultiPolygon}
 * geometry, a {@code Feature} wrapping one, or a {@code FeatureCollection}
 * holding exactly one feature — a GIS export is usually the last of these, and
 * making the user unwrap it by hand would be a needless papercut.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FduGeometryInputParser {

  private final ObjectMapper jackson;
  private final SrsValidator srsValidator;

  private static final GeometryFactory GF = new GeometryFactory();
  /** GeoJSON without a {@code crs} member is assumed BC Albers, as the spec requires. */
  private static final int DEFAULT_SRID = SrsValidator.TARGET_SRID;
  /** RFC 7946: a ring is closed and needs at least 4 positions. */
  private static final int MIN_RING_POSITIONS = 4;

  /** A parsed boundary: always valid, always in {@link SrsValidator#TARGET_SRID}. */
  public record ParsedGeometry(Geometry geometry, int srid, double areaHa, double perimeterKm) {
  }

  /** Raised for anything the user can fix by editing what they pasted. */
  public static class GeometryInputException extends IllegalArgumentException {
    public GeometryInputException(String message) {
      super(message);
    }
  }

  /**
   * Parses, validates, reprojects and measures the boundary.
   *
   * @param raw     the pasted GeoJSON or WKT
   * @param sridHint SRID to assume for WKT (which carries none). Ignored for
   *                 GeoJSON, where {@code crs.properties.name} wins if present.
   */
  public ParsedGeometry parse(String raw, Integer sridHint) {
    if (raw == null || raw.isBlank()) {
      throw new GeometryInputException("A boundary is required.");
    }
    String text = raw.trim();

    Geometry geometry;
    int declaredSrid;
    if (text.startsWith("{")) {
      JsonNode root = readJson(text);
      geometry = fromGeoJson(root);
      declaredSrid = sridFromGeoJson(root, sridHint);
    } else {
      geometry = fromWkt(text);
      declaredSrid = sridHint == null ? DEFAULT_SRID : sridHint;
    }

    requirePolygonal(geometry);

    // Topology before reprojection: a self-intersection is a defect in what
    // the user pasted, and naming it against their own coordinates is more
    // useful than naming it against reprojected ones.
    IsValidOp validOp = new IsValidOp(geometry);
    TopologyValidationError topoError = validOp.getValidationError();
    if (topoError != null) {
      throw new GeometryInputException(
          "The boundary is not a valid polygon: " + topoError.getMessage()
              + " near " + formatCoordinate(topoError));
    }

    int resolvedSrid;
    try {
      resolvedSrid = srsValidator.resolve(declaredSrid);
      geometry = srsValidator.reproject(geometry, resolvedSrid);
    } catch (SrsValidator.UnsupportedSrsException e) {
      throw new GeometryInputException(
          "Coordinate system EPSG:" + declaredSrid + " is not supported."
              + " Supply the boundary in BC Albers (EPSG:" + SrsValidator.TARGET_SRID + ").");
    }

    // BC Albers is metric, so JTS area/length come out in m² / m.
    double areaHa = geometry.getArea() / 10_000.0;
    double perimeterKm = geometry.getLength() / 1_000.0;
    if (areaHa <= 0) {
      throw new GeometryInputException(
          "The boundary encloses no area — check the ring's coordinate order.");
    }
    return new ParsedGeometry(geometry, SrsValidator.TARGET_SRID, areaHa, perimeterKm);
  }

  // ── GeoJSON ────────────────────────────────────────────────────────

  private JsonNode readJson(String text) {
    try {
      return jackson.readTree(text);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      // Jackson's message carries the offending line/column, which is the
      // single most useful thing for someone fixing a paste.
      throw new GeometryInputException("The boundary isn't valid JSON: "
          + e.getOriginalMessage());
    }
  }

  private Geometry fromGeoJson(JsonNode root) {
    JsonNode geom = unwrapToGeometry(root);
    String type = geom.path("type").asText("");
    JsonNode coordinates = geom.path("coordinates");
    if (coordinates.isMissingNode() || !coordinates.isArray()) {
      throw new GeometryInputException("The geometry has no coordinates array.");
    }
    return switch (type) {
      case "Polygon" -> polygonFrom(coordinates, "coordinates");
      case "MultiPolygon" -> multiPolygonFrom(coordinates);
      case "" -> throw new GeometryInputException("The geometry has no \"type\".");
      default -> throw new GeometryInputException(
          "Only Polygon and MultiPolygon boundaries are supported (got \"" + type + "\").");
    };
  }

  /** Peels Feature / FeatureCollection wrappers down to the geometry object. */
  private JsonNode unwrapToGeometry(JsonNode root) {
    String type = root.path("type").asText("");
    if ("FeatureCollection".equals(type)) {
      JsonNode features = root.path("features");
      if (!features.isArray() || features.isEmpty()) {
        throw new GeometryInputException("The FeatureCollection has no features.");
      }
      if (features.size() > 1) {
        throw new GeometryInputException(
            "Paste one FDU boundary at a time — this FeatureCollection holds "
                + features.size() + " features.");
      }
      return unwrapToGeometry(features.get(0));
    }
    if ("Feature".equals(type)) {
      JsonNode geometry = root.path("geometry");
      if (geometry.isMissingNode() || geometry.isNull()) {
        throw new GeometryInputException("The Feature has no geometry.");
      }
      return geometry;
    }
    return root;
  }

  private Polygon polygonFrom(JsonNode rings, String path) {
    if (!rings.isArray() || rings.isEmpty()) {
      throw new GeometryInputException(path + " must hold at least one ring.");
    }
    LinearRing shell = ringFrom(rings.get(0), path + "[0]");
    List<LinearRing> holes = new ArrayList<>();
    for (int i = 1; i < rings.size(); i++) {
      holes.add(ringFrom(rings.get(i), path + "[" + i + "]"));
    }
    return GF.createPolygon(shell, holes.toArray(new LinearRing[0]));
  }

  private MultiPolygon multiPolygonFrom(JsonNode polygons) {
    if (!polygons.isArray() || polygons.isEmpty()) {
      throw new GeometryInputException("The MultiPolygon holds no polygons.");
    }
    Polygon[] parts = new Polygon[polygons.size()];
    for (int i = 0; i < polygons.size(); i++) {
      parts[i] = polygonFrom(polygons.get(i), "coordinates[" + i + "]");
    }
    return GF.createMultiPolygon(parts);
  }

  private LinearRing ringFrom(JsonNode ring, String path) {
    if (!ring.isArray() || ring.size() < MIN_RING_POSITIONS) {
      throw new GeometryInputException(
          path + " must have at least " + MIN_RING_POSITIONS + " positions (got "
              + (ring.isArray() ? ring.size() : 0) + ").");
    }
    var coords = new org.locationtech.jts.geom.Coordinate[ring.size()];
    for (int i = 0; i < ring.size(); i++) {
      JsonNode position = ring.get(i);
      if (!position.isArray() || position.size() < 2) {
        throw new GeometryInputException(
            path + "[" + i + "] must be a coordinate pair [x, y].");
      }
      // Any third ordinate (a Z value) is permitted but ignored, per the spec.
      coords[i] = new org.locationtech.jts.geom.Coordinate(
          position.get(0).asDouble(), position.get(1).asDouble());
    }
    var first = coords[0];
    var last = coords[coords.length - 1];
    if (first.x != last.x || first.y != last.y) {
      throw new GeometryInputException(
          path + " is not closed — the first and last positions must match.");
    }
    return GF.createLinearRing(coords);
  }

  private int sridFromGeoJson(JsonNode root, Integer sridHint) {
    JsonNode name = root.path("crs").path("properties").path("name");
    if (name.isTextual()) {
      var matcher = java.util.regex.Pattern
          .compile("(?i).*?(\\d+)\\s*$")
          .matcher(name.asText().trim());
      if (matcher.matches()) {
        return Integer.parseInt(matcher.group(1));
      }
      throw new GeometryInputException(
          "Could not read an EPSG code from crs name \"" + name.asText() + "\".");
    }
    return sridHint == null ? DEFAULT_SRID : sridHint;
  }

  // ── WKT ────────────────────────────────────────────────────────────

  private Geometry fromWkt(String text) {
    try {
      return new WKTReader(GF).read(text);
    } catch (ParseException | IllegalArgumentException e) {
      throw new GeometryInputException(
          "The boundary isn't valid GeoJSON or WKT. GeoJSON must start with \"{\";"
              + " WKT should look like POLYGON((x y, x y, …)).");
    }
  }

  // ── shared ─────────────────────────────────────────────────────────

  private void requirePolygonal(Geometry geometry) {
    if (!(geometry instanceof Polygon) && !(geometry instanceof MultiPolygon)) {
      throw new GeometryInputException(
          "Only Polygon and MultiPolygon boundaries are supported (got "
              + geometry.getGeometryType() + ").");
    }
    if (geometry.isEmpty()) {
      throw new GeometryInputException("The boundary is empty.");
    }
  }

  private static String formatCoordinate(TopologyValidationError error) {
    var c = error.getCoordinate();
    return c == null ? "an unknown position" : "(" + c.x + ", " + c.y + ")";
  }
}
