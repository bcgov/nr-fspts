package ca.bc.gov.nrs.fsp.api.submission.geojson;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.CoordType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.DistrictCodeAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionMetadataType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.LicenceAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.LinearRingMemberType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.LinearRingType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.MultiPolygonType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ObjectFactory;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PlanHolderAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PolygonMemberType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PolygonType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.SingleOrMultiplePolygonPropertyType;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Parses an FSP GeoJSON submission (single FeatureCollection mixing
 * FDU + Identified Area polygons + a plan-level {@code fsp} header)
 * into an {@link FSPSubmissionType} JAXB tree — the same shape the XML
 * pipeline produces. Downstream geometry validation, preview mapping,
 * and persistence all run unchanged.
 *
 * <p>Errors that block parsing (malformed JSON, missing root features,
 * unsupported geometry types, etc.) come back as
 * {@link SubmissionValidationError}s on the {@link SubmissionXmlParser.ParseOutcome}
 * just like the XML path's errors — uniform error surface for the UI.
 */
@Component
@Slf4j
public class SubmissionGeoJsonParser {

  private static final ObjectFactory OF = new ObjectFactory();

  /** Discriminator value for FDU features. */
  private static final String ENTITY_FDU = "FDU";

  /** Discriminator value for Identified Area features. */
  private static final String ENTITY_IDENTIFIED_AREA = "IDENTIFIED_AREA";

  private final ObjectMapper jackson;

  public SubmissionGeoJsonParser(ObjectMapper jackson) {
    this.jackson = jackson;
  }

  public SubmissionXmlParser.ParseOutcome parse(byte[] bytes) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    FspGeoJson.FspGeoJsonSubmission doc;
    try {
      doc = jackson.readValue(bytes, FspGeoJson.FspGeoJsonSubmission.class);
    } catch (IOException e) {
      errors.add(SubmissionValidationError.of("GEOJSON_PARSE", e.getMessage()));
      return new SubmissionXmlParser.ParseOutcome(null, errors);
    }
    if (doc == null) {
      errors.add(SubmissionValidationError.of(
          "GEOJSON_PARSE", "empty document"));
      return new SubmissionXmlParser.ParseOutcome(null, errors);
    }
    if (!"FeatureCollection".equals(doc.type())) {
      errors.add(SubmissionValidationError.of(
          "GEOJSON_UNRECOGNIZED",
          "root .type must be \"FeatureCollection\" (got \"" + doc.type() + "\")"));
      return new SubmissionXmlParser.ParseOutcome(null, errors);
    }
    if (doc.fsp() == null) {
      errors.add(SubmissionValidationError.of(
          "GEOJSON_MISSING_FSP",
          "FeatureCollection must carry an \"fsp\" foreign member with the plan header"));
      return new SubmissionXmlParser.ParseOutcome(null, errors);
    }

    String srsName = doc.crs() == null ? null : doc.crs().srsName();
    FSPSubmissionType submission = buildSubmission(doc, srsName, errors);
    return new SubmissionXmlParser.ParseOutcome(submission, errors);
  }

  // ── Top-level build ──────────────────────────────────────────────

  private FSPSubmissionType buildSubmission(
      FspGeoJson.FspGeoJsonSubmission doc, String srsName,
      List<SubmissionValidationError> errors) {

    FspGeoJson.Header h = doc.fsp();

    FSPSubmissionMetadataType meta = OF.createFSPSubmissionMetadataType();
    if (h.submissionMetadata() != null) {
      FspGeoJson.Metadata m = h.submissionMetadata();
      meta.setLicenseeContact(m.contactName());
      meta.setTelephoneNumber(m.telephoneNumber());
      meta.setEmailAddress(m.emailAddress());
      if (m.attachmentCount() != null) {
        meta.setAttachmentCount(m.attachmentCount());
      }
    }

    ForestStewardshipPlanType plan = OF.createForestStewardshipPlanType();
    if (h.fspId() != null && !h.fspId().isBlank()) {
      try {
        plan.setFspID(Long.valueOf(h.fspId()));
      } catch (NumberFormatException e) {
        errors.add(SubmissionValidationError.of(
            "fsp.fspId", "GEOJSON_FIELD", "fspId must be numeric (got \"" + h.fspId() + "\")"));
      }
    }
    plan.setPlanName(h.planName());
    if (h.amendmentName() != null) {
      plan.setLicenseeAmendmentName(
          OF.createForestStewardshipPlanTypeLicenseeAmendmentName(h.amendmentName()));
    }
    if (h.amendmentComment() != null) {
      plan.setAmendmentComment(h.amendmentComment());
    }
    if (h.amendmentApprovalRequired() != null) {
      plan.setAmendmentApprovalRequiredInd(
          OF.createForestStewardshipPlanTypeAmendmentApprovalRequiredInd(
              h.amendmentApprovalRequired()));
    }
    plan.setActionCode(parseActionCode(h.actionCode(), errors));
    plan.setPlanTermYears(h.planTermYears());
    plan.setPlanTermMonths(h.planTermMonths());
    plan.setFrpa197Ind(h.frpa197());
    // transitionalInd is required-bool in the XSD (primitive setter,
    // not Boolean); default to false when the GeoJSON omits it.
    plan.setTransitionalInd(Boolean.TRUE.equals(h.transitional()));
    plan.setLegalDocConsolidatedInd(h.legalDocConsolidated());
    plan.setFduUpdateInd(h.fduUpdate());
    plan.setIdentifiedAreasUpdateInd(h.identifiedAreasUpdate());
    plan.setStockingStandardUpdateInd(h.stockingStandardsUpdate());

    plan.setPlanHolderList(buildPlanHolders(h.planHolders()));
    plan.setDistrictCodeList(buildDistrictCodes(h.districts()));

    FDUAssociationType fduList = OF.createFDUAssociationType();
    IdentifiedAreaAssociationType iaList = OF.createIdentifiedAreaAssociationType();

    List<FspGeoJson.Feature> features = doc.features() == null
        ? List.of()
        : doc.features();
    for (int i = 0; i < features.size(); i++) {
      FspGeoJson.Feature f = features.get(i);
      if (f == null) continue;
      String entityType = readString(f.properties(), "fspEntityType");
      String featurePath = "features[" + i + "]";
      if (entityType == null) {
        errors.add(SubmissionValidationError.of(featurePath + ".properties",
            "GEOJSON_FIELD",
            "properties.fspEntityType is required (FDU or IDENTIFIED_AREA)"));
        continue;
      }
      switch (entityType) {
        case ENTITY_FDU -> {
          FDUType fdu = buildFdu(f, srsName, featurePath, errors);
          if (fdu != null) fduList.getFdu().add(fdu);
        }
        case ENTITY_IDENTIFIED_AREA -> {
          IdentifiedAreaType ia = buildIdentifiedArea(f, srsName, featurePath, errors);
          if (ia != null) iaList.getIdentifiedArea().add(ia);
        }
        default -> errors.add(SubmissionValidationError.of(
            featurePath + ".properties.fspEntityType",
            "GEOJSON_FIELD",
            "unknown fspEntityType \"" + entityType + "\" (expected FDU or IDENTIFIED_AREA)"));
      }
    }
    if (!fduList.getFdu().isEmpty()) plan.setFduList(fduList);
    if (!iaList.getIdentifiedArea().isEmpty()) plan.setIdentifiedAreasList(iaList);

    FSPSubmissionItemAssociationType item = OF.createFSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);

    FSPSubmissionType submission = OF.createFSPSubmissionType();
    submission.setFspSubmissionMetadata(meta);
    submission.setSubmissionItem(item);
    return submission;
  }

  // ── Holders + districts ─────────────────────────────────────────

  private static PlanHolderAssociationType buildPlanHolders(List<String> codes) {
    PlanHolderAssociationType holders = OF.createPlanHolderAssociationType();
    if (codes != null) {
      for (String c : codes) {
        if (c != null && !c.isBlank()) holders.getClientCode().add(c);
      }
    }
    return holders;
  }

  private static DistrictCodeAssociationType buildDistrictCodes(List<String> codes) {
    DistrictCodeAssociationType districts = OF.createDistrictCodeAssociationType();
    if (codes != null) {
      for (String c : codes) {
        if (c != null && !c.isBlank()) districts.getDistrictCode().add(c);
      }
    }
    return districts;
  }

  // ── Features ─────────────────────────────────────────────────────

  private FDUType buildFdu(
      FspGeoJson.Feature f, String srsName, String path,
      List<SubmissionValidationError> errors) {
    FDUType fdu = OF.createFDUType();
    fdu.setFduName(readString(f.properties(), "name"));
    Object licenceNumbers = f.properties() == null ? null : f.properties().get("licenceNumbers");
    if (licenceNumbers instanceof List<?> list && !list.isEmpty()) {
      LicenceAssociationType licences = OF.createLicenceAssociationType();
      for (Object o : list) {
        if (o != null) licences.getLicenceNumber().add(o.toString());
      }
      fdu.setLicenceList(licences);
    }
    SingleOrMultiplePolygonPropertyType extent =
        buildExtent(f.geometry(), srsName, path + ".geometry", errors);
    if (extent == null) return null;
    fdu.setExtentOf(extent);
    return fdu;
  }

  private IdentifiedAreaType buildIdentifiedArea(
      FspGeoJson.Feature f, String srsName, String path,
      List<SubmissionValidationError> errors) {
    IdentifiedAreaType ia = OF.createIdentifiedAreaType();
    ia.setIdentifiedAreaName(readString(f.properties(), "name"));
    ia.setLegislationTypeCode(readString(f.properties(), "legislationTypeCode"));
    SingleOrMultiplePolygonPropertyType extent =
        buildExtent(f.geometry(), srsName, path + ".geometry", errors);
    if (extent == null) return null;
    ia.setExtentOf(extent);
    return ia;
  }

  // ── Geometry ────────────────────────────────────────────────────

  private SingleOrMultiplePolygonPropertyType buildExtent(
      FspGeoJson.Geometry geom, String srsName, String path,
      List<SubmissionValidationError> errors) {
    if (geom == null || geom.type() == null) {
      errors.add(SubmissionValidationError.of(path, "GEOMETRY_MISSING", "geometry is required"));
      return null;
    }
    SingleOrMultiplePolygonPropertyType extent = OF.createSingleOrMultiplePolygonPropertyType();
    try {
      switch (geom.type()) {
        case "Polygon" -> {
          // GeoJSON Polygon → GML MultiPolygon (single member). The
          // pipeline always treats extentOf as a multi; this keeps the
          // shape consistent with the XML path.
          PolygonType polygon = buildPolygon(geom.coordinates(), path);
          MultiPolygonType multi = OF.createMultiPolygonType();
          multi.setSrsName(srsName);
          PolygonMemberType member = OF.createPolygonMemberType();
          member.setGeometry(OF.createPolygon(polygon));
          multi.getGeometryMember().add(OF.createPolygonMember(member));
          extent.setGeometry(OF.createMultiPolygon(multi));
        }
        case "MultiPolygon" -> {
          MultiPolygonType multi = OF.createMultiPolygonType();
          multi.setSrsName(srsName);
          List<Object> polygons = geom.coordinates();
          if (polygons == null || polygons.isEmpty()) {
            throw new IllegalArgumentException("MultiPolygon coordinates are empty");
          }
          for (int i = 0; i < polygons.size(); i++) {
            Object polygonCoords = polygons.get(i);
            PolygonType polygon = buildPolygon(asList(polygonCoords), path + "[" + i + "]");
            PolygonMemberType member = OF.createPolygonMemberType();
            member.setGeometry(OF.createPolygon(polygon));
            multi.getGeometryMember().add(OF.createPolygonMember(member));
          }
          extent.setGeometry(OF.createMultiPolygon(multi));
        }
        default -> {
          errors.add(SubmissionValidationError.of(path, "GEOMETRY_UNSUPPORTED",
              "geometry.type must be Polygon or MultiPolygon (got \"" + geom.type() + "\")"));
          return null;
        }
      }
      return extent;
    } catch (RuntimeException e) {
      errors.add(SubmissionValidationError.of(path, "GEOMETRY_PARSE_ERROR", e.getMessage()));
      return null;
    }
  }

  private PolygonType buildPolygon(List<Object> rings, String path) {
    if (rings == null || rings.isEmpty()) {
      throw new IllegalArgumentException("Polygon has no rings");
    }
    PolygonType polygon = OF.createPolygonType();

    // First ring = outer boundary; subsequent rings = inner holes.
    LinearRingType outer = buildRing(asList(rings.get(0)), path + ".rings[0]");
    LinearRingMemberType outerMember = OF.createLinearRingMemberType();
    outerMember.setGeometry(OF.createLinearRing(outer));
    polygon.setOuterBoundaryIs(outerMember);

    for (int i = 1; i < rings.size(); i++) {
      LinearRingType hole = buildRing(asList(rings.get(i)), path + ".rings[" + i + "]");
      LinearRingMemberType holeMember = OF.createLinearRingMemberType();
      holeMember.setGeometry(OF.createLinearRing(hole));
      polygon.getInnerBoundaryIs().add(holeMember);
    }
    return polygon;
  }

  private LinearRingType buildRing(List<Object> coords, String path) {
    if (coords == null || coords.size() < 4) {
      throw new IllegalArgumentException(path + ": LinearRing needs at least 4 points (got "
          + (coords == null ? 0 : coords.size()) + ")");
    }
    LinearRingType ring = OF.createLinearRingType();
    for (int i = 0; i < coords.size(); i++) {
      List<Object> xy = asList(coords.get(i));
      if (xy.size() < 2) {
        throw new IllegalArgumentException(path + "[" + i
            + "]: each coordinate must be [x, y]");
      }
      CoordType c = OF.createCoordType();
      c.setX(toDecimal(xy.get(0)));
      c.setY(toDecimal(xy.get(1)));
      ring.getCoord().add(c);
    }
    return ring;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private static String readString(Map<String, Object> properties, String key) {
    if (properties == null) return null;
    Object v = properties.get(key);
    if (v == null) return null;
    String s = v.toString().trim();
    return s.isEmpty() ? null : s;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> asList(Object o) {
    if (o == null) return List.of();
    if (o instanceof List<?> l) return (List<Object>) l;
    throw new IllegalArgumentException("expected JSON array, got " + o.getClass().getSimpleName());
  }

  private static BigDecimal toDecimal(Object v) {
    if (v == null) throw new IllegalArgumentException("coordinate value is null");
    if (v instanceof Number n) return BigDecimal.valueOf(n.doubleValue());
    return new BigDecimal(v.toString());
  }

  private static ActionCodeType parseActionCode(
      String code, List<SubmissionValidationError> errors) {
    if (code == null || code.isBlank()) return null;
    try {
      return ActionCodeType.fromValue(code);
    } catch (IllegalArgumentException e) {
      errors.add(SubmissionValidationError.of(
          "fsp.actionCode", "GEOJSON_FIELD",
          "actionCode must be I, U, or A (got \"" + code + "\")"));
      return null;
    }
  }

  // Used to satisfy the linter / silence an unused-warning if any field
  // is dropped during future refactors.
  @SuppressWarnings("unused")
  private static BigInteger toBigInteger(Integer i) {
    return i == null ? null : BigInteger.valueOf(i);
  }

  @SuppressWarnings("unused")
  private static void ensureNotNull(Object o, String name) {
    Objects.requireNonNull(o, name);
  }
}
