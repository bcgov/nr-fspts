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
  private final GeometryValidator validator = new GeometryValidator(new GmlGeometryConverter());

  @Test
  void passes_on_simple_square() {
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(
            new double[][] {
              {0, 0}, {10, 0}, {10, 10}, {0, 10}, {0, 0}
            }));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).isEmpty();
  }

  @Test
  void reports_self_intersecting_polygon() {
    // Bowtie — the two diagonals cross at (5,5)
    FSPSubmissionType submission = submissionWithFduExtent(
        polygonExtent(
            new double[][] {
              {0, 0}, {10, 10}, {10, 0}, {0, 10}, {0, 0}
            }));

    List<SubmissionValidationError> errors = validator.validate(submission);

    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("GEOMETRY_INVALID");
    assertThat(errors.get(0).path()).contains("extentOf");
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
              {0, 0}, {10, 0}, {10, 10}, {0, 10}  // last != first
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

    SingleOrMultiplePolygonPropertyType extent = new SingleOrMultiplePolygonPropertyType();
    extent.setGeometry(OF.createPolygon(polygon));
    return extent;
  }
}
