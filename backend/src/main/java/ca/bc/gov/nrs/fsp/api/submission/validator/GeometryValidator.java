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
  private final SrsValidator srsValidator;
  private final BcBoundaryValidator bcBoundary;
  private final GeometrySimplifier simplifier;

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
      // 1. SRS check — reject any code not on the allowlist BEFORE
      //    converting coords. Catches mistyped srsName up front.
      int rawSrid = converter.sridFromExtent(extent);
      int resolvedSrid;
      try {
        resolvedSrid = srsValidator.resolve(rawSrid);
      } catch (SrsValidator.UnsupportedSrsException ue) {
        errors.add(SubmissionValidationError.of(path, "SRS_UNSUPPORTED", ue.getMessage()));
        return;
      }
      // 2. GML → JTS (still in input coordinates).
      Geometry jts = converter.toJts(extent);
      // 3. Reproject to 3005 if needed so all downstream code (bounds,
      //    simplify, persist) runs in BC Albers metres.
      jts = srsValidator.reproject(jts, resolvedSrid);
      // 4. JTS topology check.
      IsValidOp op = new IsValidOp(jts);
      TopologyValidationError topoErr = op.getValidationError();
      if (topoErr != null) {
        errors.add(SubmissionValidationError.of(
            path, "GEOMETRY_INVALID", topoErr.getMessage()));
        return;
      }
      // 5. BC containment — check the (now-reprojected, topology-valid)
      //    geometry sits inside the BC outline. Skip when prior steps
      //    failed since a malformed polygon could throw under covers().
      if (!bcBoundary.isInsideBc(jts)) {
        errors.add(SubmissionValidationError.of(
            path, "GEOMETRY_OUTSIDE_BC",
            "geometry is not inside the BC provincial boundary"));
        return;
      }
      // 6. Simplify (Douglas-Peucker 2.5m) + snap to 0.001m precision
      //    grid + re-validate. Falls back to TopologyPreservingSimplifier
      //    if the DP output trips IsValidOp. Write the result back to
      //    the JAXB tree so persistence picks up the storage-ready
      //    coordinates without any extra plumbing.
      try {
        org.locationtech.jts.geom.Geometry simplified =
            simplifier.simplifyAndSnap(jts);
        converter.writeJtsToExtent(simplified, extent, "EPSG:" + SrsValidator.TARGET_SRID);
      } catch (GeometrySimplifier.SimplificationException sx) {
        errors.add(SubmissionValidationError.of(
            path, "SIMPLIFY_INVALID", sx.getMessage()));
      }
    } catch (GmlConversionException e) {
      errors.add(SubmissionValidationError.of(path, "GEOMETRY_PARSE_ERROR", e.getMessage()));
    }
  }

  private static String nameOrIndex(String name, int idx) {
    return name == null || name.isBlank() ? "#" + idx : name;
  }
}
