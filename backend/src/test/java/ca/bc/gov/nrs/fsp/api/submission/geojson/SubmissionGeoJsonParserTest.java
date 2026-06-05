package ca.bc.gov.nrs.fsp.api.submission.geojson;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.MultiPolygonType;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Drives the GeoJSON parser against the canned Mackenzie fixture so
 * we lock in the JAXB-tree projection (plan header → ForestStewardshipPlanType,
 * features → FDU/IA collections, polygon coords → GML rings).
 */
class SubmissionGeoJsonParserTest {

  private final SubmissionGeoJsonParser parser =
      new SubmissionGeoJsonParser(new ObjectMapper());

  @Test
  void parses_valid_mackenzie_geojson() throws IOException {
    SubmissionXmlParser.ParseOutcome outcome = parser.parse(read("valid-mackenzie-96-amend6.geojson"));

    assertThat(outcome.errors())
        .as("happy-path fixture should parse cleanly")
        .isEmpty();
    FSPSubmissionType submission = outcome.submission();
    assertThat(submission).isNotNull();

    // ── Envelope metadata ──
    assertThat(submission.getFspSubmissionMetadata().getLicenseeContact())
        .isEqualTo("Test Contact");
    assertThat(submission.getFspSubmissionMetadata().getEmailAddress())
        .isEqualTo("test.contact@example.com");
    assertThat(submission.getFspSubmissionMetadata().getAttachmentCount()).isZero();

    // ── Plan header ──
    ForestStewardshipPlanType plan = submission.getSubmissionItem().getForestStewardshipPlan();
    assertThat(plan.getFspID()).isEqualTo(96L);
    assertThat(plan.getPlanName()).isEqualTo("Sample Mackenzie TSA FSP");
    assertThat(plan.getActionCode()).isEqualTo(ActionCodeType.A);
    assertThat(plan.getPlanTermYears()).isEqualTo(5);
    assertThat(plan.isFrpa197Ind()).isTrue();
    assertThat(plan.isTransitionalInd()).isFalse();

    // ── Holders + districts ──
    assertThat(plan.getPlanHolderList().getClientCode())
        .containsExactly("00001271", "00161366");
    assertThat(plan.getDistrictCodeList().getDistrictCode())
        .containsExactly("DMK");

    // ── FDU ──
    assertThat(plan.getFduList().getFdu()).hasSize(1);
    FDUType fdu = plan.getFduList().getFdu().get(0);
    assertThat(fdu.getFduName()).isEqualTo("Sample North FDU");
    assertThat(fdu.getLicenceList().getLicenceNumber()).containsExactly("A15384");
    // Polygon → MultiPolygon (single member). Confirm the SRS rode through.
    MultiPolygonType fduGeom =
        (MultiPolygonType) fdu.getExtentOf().getGeometry().getValue();
    assertThat(fduGeom.getSrsName()).isEqualTo("EPSG:3005");
    assertThat(fduGeom.getGeometryMember()).hasSize(1);

    // ── Identified Area ──
    assertThat(plan.getIdentifiedAreasList().getIdentifiedArea()).hasSize(1);
    IdentifiedAreaType ia = plan.getIdentifiedAreasList().getIdentifiedArea().get(0);
    assertThat(ia.getIdentifiedAreaName()).isEqualTo("Caribou Habitat Sample");
    assertThat(ia.getLegislationTypeCode()).isEqualTo("FRPA196(1)");
  }

  @Test
  void rejects_non_feature_collection_root() {
    SubmissionXmlParser.ParseOutcome outcome =
        parser.parse("{\"type\":\"Feature\"}".getBytes());

    assertThat(outcome.submission()).isNull();
    assertThat(outcome.errors())
        .extracting(SubmissionValidationError::code)
        .contains("GEOJSON_UNRECOGNIZED");
  }

  @Test
  void rejects_missing_fsp_header() {
    SubmissionXmlParser.ParseOutcome outcome = parser.parse(
        "{\"type\":\"FeatureCollection\",\"features\":[]}".getBytes());

    assertThat(outcome.submission()).isNull();
    assertThat(outcome.errors())
        .extracting(SubmissionValidationError::code)
        .contains("GEOJSON_MISSING_FSP");
  }

  @Test
  void flags_unknown_entity_type_but_continues() {
    String doc = """
        {
          "type": "FeatureCollection",
          "fsp": { "fspId": "1", "planName": "X" },
          "features": [
            { "type": "Feature",
              "geometry": {"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},
              "properties": { "fspEntityType": "ROAD" } }
          ]
        }""";
    SubmissionXmlParser.ParseOutcome outcome = parser.parse(doc.getBytes());

    assertThat(outcome.submission()).isNotNull(); // top-level structure parsed
    assertThat(outcome.errors())
        .extracting(SubmissionValidationError::code)
        .contains("GEOJSON_FIELD");
  }

  private byte[] read(String name) throws IOException {
    return new ClassPathResource("fixtures/submissions/" + name)
        .getInputStream().readAllBytes();
  }
}
