package ca.bc.gov.nrs.fsp.api.submission.parser;

import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import jakarta.xml.bind.JAXBElement;
import org.locationtech.jts.geom.*;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Converts the JAXB-parsed GML 2.x geometry inside an FDU or
 * IdentifiedArea {@code <extentOf>} element into a JTS geometry, and
 * pulls the SRID out of the {@code srsName} attribute. Shared by
 * {@code GeometryValidator} (topology check) and the persistence
 * path (build SDO_GEOMETRY via WKT).
 */
@Component
public class GmlGeometryConverter {

  private static final GeometryFactory GF = new GeometryFactory();
  private static final Pattern EPSG_PATTERN =
      Pattern.compile(".*?(\\d+)$"); // matches "EPSG:42102" or "urn:ogc:def:crs:EPSG::42102"

  /**
   * Map legacy EPSG codes to the canonical codes Oracle Spatial actually
   * carries in {@code MDSYS.SDO_CS}. Submissions from the ESF era are
   * tagged with {@code EPSG:42102} (NAD83/BC Albers, original code), but
   * modern Oracle installations only recognise the current EPSG code
   * {@code 3005} for the same projection. Bind 42102 directly and the
   * spatial-validation trigger trips {@code ORA-13199 SRID does not exist}.
   *
   * <p>Same coordinate system, same datum, same parameters — only the
   * registered identifier changes.
   */
  private static final java.util.Map<Integer, Integer> LEGACY_EPSG_REMAP =
      java.util.Map.of(
          42102, 3005   // NAD83 / BC Albers
      );

  public Geometry toJts(SingleOrMultiplePolygonPropertyType extent) throws GmlConversionException {
    if (extent == null || extent.getGeometry() == null) {
      throw new GmlConversionException("extentOf is missing or empty");
    }
    Object value = extent.getGeometry().getValue();
    if (value instanceof PolygonType polygon) {
      return convertPolygon(polygon);
    }
    if (value instanceof MultiPolygonType mp) {
      return convertMultiPolygon(mp);
    }
    throw new GmlConversionException(
        "extentOf must contain a Polygon or MultiPolygon (got "
            + (value == null ? "null" : value.getClass().getSimpleName()) + ")");
  }

  /**
   * Parses the {@code srsName} attribute (e.g. "EPSG:42102" or
   * "urn:ogc:def:crs:EPSG::4326") into the trailing numeric code,
   * which Oracle stores directly as {@code SDO_SRID}.
   */
  public int sridFromExtent(SingleOrMultiplePolygonPropertyType extent)
      throws GmlConversionException {
    if (extent == null || extent.getGeometry() == null) {
      throw new GmlConversionException("extentOf has no geometry — cannot read srsName");
    }
    Object value = extent.getGeometry().getValue();
    if (!(value instanceof AbstractGeometryType geom)) {
      throw new GmlConversionException("extentOf geometry is not an AbstractGeometryType");
    }
    String srsName = geom.getSrsName();
    if (srsName == null || srsName.isBlank()) {
      throw new GmlConversionException("geometry has no srsName attribute");
    }
    var m = EPSG_PATTERN.matcher(srsName.trim());
    if (!m.matches()) {
      throw new GmlConversionException("could not extract EPSG code from srsName=" + srsName);
    }
    int raw = Integer.parseInt(m.group(1));
    return LEGACY_EPSG_REMAP.getOrDefault(raw, raw);
  }

  private Polygon convertPolygon(PolygonType polygon) throws GmlConversionException {
    LinearRing shell = ringFromMember(polygon.getOuterBoundaryIs(), "outerBoundaryIs");
    List<LinearRingMemberType> innerList = polygon.getInnerBoundaryIs();
    LinearRing[] holes = new LinearRing[innerList == null ? 0 : innerList.size()];
    if (innerList != null) {
      for (int i = 0; i < innerList.size(); i++) {
        holes[i] = ringFromMember(innerList.get(i), "innerBoundaryIs[" + i + "]");
      }
    }
    return GF.createPolygon(shell, holes);
  }

  private MultiPolygon convertMultiPolygon(MultiPolygonType mp) throws GmlConversionException {
    List<JAXBElement<? extends GeometryAssociationType>> members = mp.getGeometryMember();
    if (members == null || members.isEmpty()) {
      throw new GmlConversionException("MultiPolygon has no polygonMember elements");
    }
    Polygon[] polys = new Polygon[members.size()];
    for (int i = 0; i < members.size(); i++) {
      GeometryAssociationType member = members.get(i).getValue();
      if (!(member instanceof PolygonMemberType pm)) {
        throw new GmlConversionException(
            "polygonMember[" + i + "] is " + member.getClass().getSimpleName()
                + ", expected PolygonMemberType");
      }
      JAXBElement<?> inner = pm.getGeometry();
      if (inner == null || !(inner.getValue() instanceof PolygonType polygon)) {
        throw new GmlConversionException(
            "polygonMember[" + i + "] is missing a <Polygon> element");
      }
      polys[i] = convertPolygon(polygon);
    }
    return GF.createMultiPolygon(polys);
  }

  private LinearRing ringFromMember(LinearRingMemberType member, String label)
      throws GmlConversionException {
    if (member == null) {
      throw new GmlConversionException(label + " is missing");
    }
    JAXBElement<?> ringEl = member.getGeometry();
    if (ringEl == null || !(ringEl.getValue() instanceof LinearRingType ring)) {
      throw new GmlConversionException(label + " is missing a <LinearRing> element");
    }
    Coordinate[] coords = extractCoordinates(ring, label);
    if (coords.length < 4) {
      throw new GmlConversionException(
          label + " has only " + coords.length + " coordinate(s); a ring requires at least 4");
    }
    if (!coords[0].equals2D(coords[coords.length - 1])) {
      throw new GmlConversionException(label + " is not closed (first coord != last coord)");
    }
    return GF.createLinearRing(coords);
  }

  private Coordinate[] extractCoordinates(LinearRingType ring, String label)
      throws GmlConversionException {
    List<CoordType> coordList = ring.getCoord();
    if (coordList != null && !coordList.isEmpty()) {
      Coordinate[] out = new Coordinate[coordList.size()];
      for (int i = 0; i < coordList.size(); i++) {
        CoordType c = coordList.get(i);
        if (c.getX() == null || c.getY() == null) {
          throw new GmlConversionException(label + "/coord[" + i + "] missing x or y");
        }
        out[i] = new Coordinate(c.getX().doubleValue(), c.getY().doubleValue());
      }
      return out;
    }
    CoordinatesType coordinates = ring.getCoordinates();
    if (coordinates == null || coordinates.getValue() == null) {
      throw new GmlConversionException(label + " has no <coord> or <coordinates>");
    }
    return parseCoordinatesBlob(coordinates, label);
  }

  private Coordinate[] parseCoordinatesBlob(CoordinatesType coordinates, String label)
      throws GmlConversionException {
    String ts = coordinates.getTs();
    String cs = coordinates.getCs();
    if (cs == null || cs.isEmpty()) {
      cs = ",";
    }
    String raw = coordinates.getValue().trim();
    String[] tuples = (ts == null || ts.isEmpty())
        ? raw.split("\\s+")
        : raw.split(Pattern.quote(ts));
    Coordinate[] out = new Coordinate[tuples.length];
    for (int i = 0; i < tuples.length; i++) {
      String[] parts = tuples[i].split(Pattern.quote(cs));
      if (parts.length < 2) {
        throw new GmlConversionException(
            label + "/coordinates tuple[" + i + "] needs at least x and y");
      }
      try {
        out[i] = new Coordinate(Double.parseDouble(parts[0]), Double.parseDouble(parts[1]));
      } catch (NumberFormatException nfe) {
        throw new GmlConversionException(
            label + "/coordinates tuple[" + i + "] is not numeric: " + tuples[i]);
      }
    }
    return out;
  }
}
