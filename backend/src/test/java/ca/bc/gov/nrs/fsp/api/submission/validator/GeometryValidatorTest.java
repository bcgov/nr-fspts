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
    BcBoundaryValidator bc = new BcBoundaryValidator();
    bc.loadBoundary();
    return new GeometryValidator(
        new GmlGeometryConverter(), srs, bc, new GeometrySimplifier());
  }

  // Test polygons live near central BC in EPSG:3005 (around Prince
  // George ~1,200,000 E / 1,000,000 N) so they pass both the SRS
  // check and the new BC-containment check.
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
  void reports_outside_bc() {
    // Far-east-of-BC polygon (Saskatchewan range in BC Albers) — same
    // valid topology, just way past our boundary.
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(squareAt(3_000_000, 1_000_000, 1000)));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("GEOMETRY_OUTSIDE_BC");
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
