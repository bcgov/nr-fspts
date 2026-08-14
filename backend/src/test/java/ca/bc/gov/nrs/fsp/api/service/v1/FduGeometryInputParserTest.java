package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.submission.validator.SrsValidator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link FduGeometryInputParser} — the "Add FDU" dialog's
 * boundary field.
 *
 * <p>This is the one genuinely new piece of geometry code in the feature, and
 * everything a user can get wrong lands here: wrong JSON, wrong geometry type,
 * an unclosed ring, a self-intersection, a projection we can't handle. Each of
 * those has to come back as a sentence they can act on, not an ORA- error from
 * the spatial trigger three layers down.
 */
class FduGeometryInputParserTest {

  private final FduGeometryInputParser parser =
      new FduGeometryInputParser(new ObjectMapper(), new SrsValidator());

  /** A 500m × 500m square in BC Albers — 25 ha, 2 km around. */
  private static final String SQUARE_RING =
      "[[1200000,460000],[1200500,460000],[1200500,460500],[1200000,460500],[1200000,460000]]";

  private static String polygonJson(String ring) {
    return "{\"type\":\"Polygon\",\"coordinates\":[" + ring + "]}";
  }

  // ── happy paths ──────────────────────────────────────────────────────

  @Test
  void parsesABareGeoJsonPolygonAndMeasuresIt() {
    var parsed = parser.parse(polygonJson(SQUARE_RING), null);

    assertThat(parsed.srid()).isEqualTo(SrsValidator.TARGET_SRID);
    assertThat(parsed.areaHa()).isEqualTo(25.0, org.assertj.core.data.Offset.offset(0.001));
    assertThat(parsed.perimeterKm()).isEqualTo(2.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void parsesWkt() {
    String wkt = "POLYGON((1200000 460000, 1200500 460000, 1200500 460500,"
        + " 1200000 460500, 1200000 460000))";
    var parsed = parser.parse(wkt, null);
    assertThat(parsed.areaHa()).isEqualTo(25.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void unwrapsAFeature() {
    String feature = "{\"type\":\"Feature\",\"properties\":{},\"geometry\":"
        + polygonJson(SQUARE_RING) + "}";
    assertThatCode(() -> parser.parse(feature, null)).doesNotThrowAnyException();
  }

  @Test
  void unwrapsASingleFeatureCollection() {
    // What a GIS export actually looks like — making the user unwrap it by
    // hand would be a needless papercut.
    String fc = "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\","
        + "\"properties\":{},\"geometry\":" + polygonJson(SQUARE_RING) + "}]}";
    assertThatCode(() -> parser.parse(fc, null)).doesNotThrowAnyException();
  }

  @Test
  void parsesAMultiPolygon() {
    String mp = "{\"type\":\"MultiPolygon\",\"coordinates\":[[" + SQUARE_RING + "]]}";
    var parsed = parser.parse(mp, null);
    assertThat(parsed.areaHa()).isEqualTo(25.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void ignoresAThirdOrdinate() {
    // Z values are permitted but ignored, per the submission spec.
    String ringWithZ =
        "[[1200000,460000,12],[1200500,460000,12],[1200500,460500,12],"
            + "[1200000,460500,12],[1200000,460000,12]]";
    var parsed = parser.parse(polygonJson(ringWithZ), null);
    assertThat(parsed.areaHa()).isEqualTo(25.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void subtractsAnInteriorRing() {
    // A hole must reduce the measured area — otherwise the value written to
    // FEATURE_AREA overstates the FDU.
    String hole =
        "[[1200100,460100],[1200200,460100],[1200200,460200],[1200100,460200],[1200100,460100]]";
    String withHole = "{\"type\":\"Polygon\",\"coordinates\":[" + SQUARE_RING + "," + hole + "]}";
    var parsed = parser.parse(withHole, null);
    assertThat(parsed.areaHa()).isEqualTo(24.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void acceptsAClockwiseExteriorRing() {
    // Winding is normalised at the call site, not rejected here — plenty of
    // source files produce CW exteriors.
    String cw =
        "[[1200000,460000],[1200000,460500],[1200500,460500],[1200500,460000],[1200000,460000]]";
    var parsed = parser.parse(polygonJson(cw), null);
    assertThat(parsed.areaHa()).isEqualTo(25.0, org.assertj.core.data.Offset.offset(0.001));
  }

  @Test
  void readsTheSridFromACrsMember() {
    String withCrs = "{\"type\":\"Polygon\",\"crs\":{\"type\":\"name\",\"properties\":"
        + "{\"name\":\"EPSG:3005\"}},\"coordinates\":[" + SQUARE_RING + "]}";
    assertThatCode(() -> parser.parse(withCrs, null)).doesNotThrowAnyException();
  }

  // ── rejections ───────────────────────────────────────────────────────

  @Test
  void rejectsABlankBoundary() {
    assertThatThrownBy(() -> parser.parse("   ", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("required");
  }

  @Test
  void rejectsMalformedJsonWithTheParsersOwnDetail() {
    assertThatThrownBy(() -> parser.parse("{\"type\":\"Polygon\",", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("valid JSON");
  }

  @Test
  void rejectsTextThatIsNeitherGeoJsonNorWkt() {
    assertThatThrownBy(() -> parser.parse("just some words", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("GeoJSON or WKT");
  }

  @Test
  void rejectsANonPolygonGeometry() {
    assertThatThrownBy(() ->
        parser.parse("{\"type\":\"Point\",\"coordinates\":[1200000,460000]}", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("Polygon and MultiPolygon");
  }

  @Test
  void rejectsANonPolygonWkt() {
    assertThatThrownBy(() -> parser.parse("POINT(1200000 460000)", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("Polygon and MultiPolygon");
  }

  @Test
  void rejectsAnUnclosedRing() {
    String open =
        "[[1200000,460000],[1200500,460000],[1200500,460500],[1200000,460500]]";
    assertThatThrownBy(() -> parser.parse(polygonJson(open), null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("not closed");
  }

  @Test
  void rejectsARingWithTooFewPositions() {
    assertThatThrownBy(() ->
        parser.parse(polygonJson("[[1200000,460000],[1200500,460000],[1200000,460000]]"), null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("at least 4 positions");
  }

  @Test
  void rejectsASelfIntersectingRing() {
    // A bow-tie. Oracle's MOF_SPATIAL_VALIDATION would reject this at insert
    // time with an ORA- error; catching it here names the offending position.
    String bowTie =
        "[[1200000,460000],[1200500,460500],[1200500,460000],[1200000,460500],[1200000,460000]]";
    assertThatThrownBy(() -> parser.parse(polygonJson(bowTie), null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("not a valid polygon");
  }

  @Test
  void rejectsAFeatureCollectionHoldingMoreThanOneFeature() {
    String two = "{\"type\":\"FeatureCollection\",\"features\":["
        + "{\"type\":\"Feature\",\"properties\":{},\"geometry\":" + polygonJson(SQUARE_RING) + "},"
        + "{\"type\":\"Feature\",\"properties\":{},\"geometry\":" + polygonJson(SQUARE_RING) + "}]}";
    assertThatThrownBy(() -> parser.parse(two, null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("one FDU boundary at a time");
  }

  @Test
  void rejectsAnEmptyFeatureCollection() {
    assertThatThrownBy(() ->
        parser.parse("{\"type\":\"FeatureCollection\",\"features\":[]}", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("no features");
  }

  @Test
  void rejectsAGeometryWithNoType() {
    assertThatThrownBy(() -> parser.parse("{\"coordinates\":[" + SQUARE_RING + "]}", null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("no \"type\"");
  }

  @Test
  void rejectsAnUnreadableCrsName() {
    String badCrs = "{\"type\":\"Polygon\",\"crs\":{\"type\":\"name\",\"properties\":"
        + "{\"name\":\"not-an-epsg\"}},\"coordinates\":[" + SQUARE_RING + "]}";
    assertThatThrownBy(() -> parser.parse(badCrs, null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("EPSG code");
  }

  @Test
  void rejectsAnUnsupportedProjection() {
    // Surfaces as advice to re-export in BC Albers rather than as an
    // UnsupportedSrsException escaping to a 500.
    String utm = "{\"type\":\"Polygon\",\"crs\":{\"type\":\"name\",\"properties\":"
        + "{\"name\":\"EPSG:26910\"}},\"coordinates\":[" + SQUARE_RING + "]}";
    assertThatThrownBy(() -> parser.parse(utm, null))
        .isInstanceOf(FduGeometryInputParser.GeometryInputException.class)
        .hasMessageContaining("not supported");
  }
}
