package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlConversionException;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.operation.valid.IsValidOp;
import org.locationtech.jts.operation.valid.TopologyValidationError;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Walks an unmarshalled {@link FSPSubmissionType}, converts each FDU
 * and Identified Area extent (GML 2.x Polygon / MultiPolygon) into a
 * JTS geometry via {@link GmlGeometryConverter}, and runs
 * {@link IsValidOp} on it. Reports topology problems and missing
 * required ring data.
 *
 * <p>Phase 1 scope: topology validity only. Containment and SRS-bounds
 * checks belong to the business-rule validator.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GeometryValidator {

  private final GmlGeometryConverter converter;

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) {
      return errors;
    }

    validateFdus(plan.getFduList(), errors);
    validateIdentifiedAreas(plan.getIdentifiedAreasList(), errors);
    return errors;
  }

  private void validateFdus(FDUAssociationType fduList, List<SubmissionValidationError> errors) {
    if (fduList == null || fduList.getFdu() == null) {
      return;
    }
    List<FDUType> fdus = fduList.getFdu();
    for (int i = 0; i < fdus.size(); i++) {
      FDUType fdu = fdus.get(i);
      String fduPath = String.format(
          "forestStewardshipPlan/fduList/fdu[%d](%s)", i, nameOrIndex(fdu.getFduName(), i));
      validateExtent(fduPath + "/extentOf", fdu.getExtentOf(), errors);
    }
  }

  private void validateIdentifiedAreas(
      IdentifiedAreaAssociationType iaList,
      List<SubmissionValidationError> errors) {
    if (iaList == null || iaList.getIdentifiedArea() == null) {
      return;
    }
    List<IdentifiedAreaType> areas = iaList.getIdentifiedArea();
    for (int i = 0; i < areas.size(); i++) {
      IdentifiedAreaType area = areas.get(i);
      String areaPath = String.format(
          "forestStewardshipPlan/identifiedAreasList/identifiedArea[%d](%s)",
          i, nameOrIndex(area.getIdentifiedAreaName(), i));
      validateExtent(areaPath + "/extentOf", area.getExtentOf(), errors);
    }
  }

  private void validateExtent(
      String path,
      SingleOrMultiplePolygonPropertyType extent,
      List<SubmissionValidationError> errors) {
    if (extent == null || extent.getGeometry() == null) {
      errors.add(SubmissionValidationError.of(path, "GEOMETRY_MISSING", "extentOf is missing or empty"));
      return;
    }
    try {
      Geometry jts = converter.toJts(extent);
      IsValidOp op = new IsValidOp(jts);
      TopologyValidationError topoErr = op.getValidationError();
      if (topoErr != null) {
        errors.add(SubmissionValidationError.of(
            path, "GEOMETRY_INVALID", topoErr.getMessage()));
      }
    } catch (GmlConversionException e) {
      errors.add(SubmissionValidationError.of(path, "GEOMETRY_PARSE_ERROR", e.getMessage()));
    }
  }

  private static String nameOrIndex(String name, int idx) {
    return name == null || name.isBlank() ? "#" + idx : name;
  }
}
