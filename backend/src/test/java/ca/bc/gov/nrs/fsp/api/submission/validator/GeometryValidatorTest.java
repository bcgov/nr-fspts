package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure-Java unit tests — no Spring context. Builds JAXB trees by hand
 * to exercise GeometryValidator's GML → JTS conversion and the
 * topology check.
 */
class GeometryValidatorTest {

  private static final ObjectFactory OF = new ObjectFactory();
  private final GeometryValidator validator = newValidator();

  private static GeometryValidator newValidator() {
    SrsValidator srs = new SrsValidator();
    srs.initTransforms();
    return new GeometryValidator(
        new GmlGeometryConverter(), srs, new GeometrySimplifier());
  }

  // Test polygons live near central BC in EPSG:3005 (around Prince
  // George ~1,200,000 E / 1,000,000 N) so they pass the SRS check.
  private static double[][] squareAt(double e, double n, double side) {
    return new double[][] {
      {e, n}, {e + side, n}, {e + side, n + side}, {e, n + side}, {e, n}
    };
  }

  @Test
  void passes_on_simple_square() {
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(squareAt(1_200_000, 1_000_000, 1000)));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).isEmpty();
  }

  @Test
  void reports_self_intersecting_polygon() {
    // Bowtie centred on a BC location so it doesn't double-fail on the
    // bounds check before the topology check fires.
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(
            new double[][] {
              {1_200_000, 1_000_000},
              {1_201_000, 1_001_000},
              {1_201_000, 1_000_000},
              {1_200_000, 1_001_000},
              {1_200_000, 1_000_000}
            }));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("GEOMETRY_INVALID");
    assertThat(errors.get(0).path()).contains("extentOf");
  }

  @Test
  void does_not_reject_geometry_outside_the_province() {
    // Deliberate: we do NOT enforce provincial containment. A check was
    // added during the rewrite that neither predecessor had — ESF, where
    // these submissions were actually uploaded, validated only XML schema
    // and GML parse correctness, and the legacy nr-fsp app never ingested
    // geometry at all. It rejected valid coastal plans, so it was removed.
    //
    // This polygon sits well east of BC (Saskatchewan range in BC Albers)
    // with perfectly valid topology. It must pass.
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(squareAt(3_000_000, 1_000_000, 1000)));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).isEmpty();
  }

  @Test
  void accepts_a_coastal_extent_that_the_old_boundary_check_rejected() {
    // Taken from the central-coast submission that exposed the problem
    // (Hailzaqv Territory). These coordinates are genuine BC Albers and
    // were refused by the removed check's placeholder boundary.
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(squareAt(720_431, 793_326, 1000)));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).isEmpty();
  }

  @Test
  void reports_missing_extent() {
    FDUType fdu = new FDUType();
    fdu.setFduName("FDU-A");
    // no extentOf set
    FDUAssociationType fduList = new FDUAssociationType();
    fduList.getFdu().add(fdu);

    FSPSubmissionType submission = wrap(planWith(fduList));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("GEOMETRY_MISSING");
  }

  @Test
  void reports_unclosed_ring() {
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(
            new double[][] {
              {1_200_000, 1_000_000},
              {1_201_000, 1_000_000},
              {1_201_000, 1_001_000},
              {1_200_000, 1_001_000}   // last != first
            }));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("GEOMETRY_PARSE_ERROR");
    assertThat(errors.get(0).message()).contains("not closed");
  }

  // -------- builders --------

  private FSPSubmissionType submissionWithFduExtent(SingleOrMultiplePolygonPropertyType extent) {
    FDUType fdu = new FDUType();
    fdu.setFduName("FDU-A");
    fdu.setExtentOf(extent);
    FDUAssociationType fduList = new FDUAssociationType();
    fduList.getFdu().add(fdu);
    return wrap(planWith(fduList));
  }

  private ForestStewardshipPlanType planWith(FDUAssociationType fduList) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setFduList(fduList);
    return plan;
  }

  private FSPSubmissionType wrap(ForestStewardshipPlanType plan) {
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }

  private SingleOrMultiplePolygonPropertyType polygonExtent(double[][] coords) {
    LinearRingType ring = new LinearRingType();
    for (double[] xy : coords) {
      CoordType c = new CoordType();
      c.setX(BigDecimal.valueOf(xy[0]));
      c.setY(BigDecimal.valueOf(xy[1]));
      ring.getCoord().add(c);
    }
    LinearRingMemberType ringMember = new LinearRingMemberType();
    ringMember.setGeometry(OF.createLinearRing(ring));

    PolygonType polygon = new PolygonType();
    polygon.setOuterBoundaryIs(ringMember);
    // srsName lives on the AbstractGeometryType — set on the Polygon
    // (or wrap in a single-member MultiPolygon, which SrsValidator
    // also handles). 3005 = BC Albers, our canonical CRS.
    polygon.setSrsName("EPSG:3005");

    SingleOrMultiplePolygonPropertyType extent = new SingleOrMultiplePolygonPropertyType();
    extent.setGeometry(OF.createPolygon(polygon));
    return extent;
  }
}
