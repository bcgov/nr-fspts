package ca.bc.gov.nrs.fsp.api.submission;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Sil21ClientSearchDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.DistrictCodeAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPStandardsType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionMetadataType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.MultiPolygonType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PlanHolderAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PolygonType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.SingleOrMultiplePolygonPropertyType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardsAssociationType;
import jakarta.xml.bind.JAXBElement;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.xml.datatype.XMLGregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Projects a parsed {@link FSPSubmissionType} into the read-only
 * {@link SubmissionPreview} DTO the upload UI renders post-validation.
 *
 * <p>No DB lookups happen here — every value reflects the XML verbatim.
 * Code-list resolution (district name from district code, client name
 * from client number, status description from status code, etc.) is
 * deferred to the production FSP-information view which has the
 * post-persistence resolved labels.
 */
@Component
@Slf4j
public class SubmissionPreviewMapper {

  private final FspCodeListsDao codeListsDao;
  private final Sil21ClientSearchDao clientSearchDao;

  public SubmissionPreviewMapper(
      FspCodeListsDao codeListsDao, Sil21ClientSearchDao clientSearchDao) {
    this.codeListsDao = codeListsDao;
    this.clientSearchDao = clientSearchDao;
  }

  public SubmissionPreview toPreview(FSPSubmissionType submission) {
    if (submission == null) return null;
    ForestStewardshipPlanType plan = unwrapPlan(submission);
    FSPSubmissionMetadataType meta = submission.getFspSubmissionMetadata();

    SubmissionPreview.Metadata metadata = new SubmissionPreview.Metadata(
        meta == null ? null : meta.getLicenseeContact(),
        meta == null ? null : meta.getTelephoneNumber(),
        meta == null ? null : meta.getEmailAddress(),
        meta == null ? null : meta.getAttachmentCount());

    SubmissionPreview.PlanHeader header = plan == null
        ? new SubmissionPreview.PlanHeader(null, null, null, null, null,
            null, null, null, null, null, null, null)
        : new SubmissionPreview.PlanHeader(
            asString(plan.getFspID()),
            plan.getPlanName(),
            jaxbValue(plan.getLicenseeAmendmentName()),
            plan.getActionCode() == null ? null : plan.getActionCode().value(),
            describeActionCode(plan.getActionCode()),
            jaxbValue(plan.getAmendmentApprovalRequiredInd()),
            plan.isFduUpdateInd(),
            plan.isIdentifiedAreasUpdateInd(),
            plan.isStockingStandardUpdateInd(),
            plan.isFrpa197Ind(),
            plan.isTransitionalInd(),
            plan.isLegalDocConsolidatedInd());

    // The submission XML doesn't carry a plan-start date — that's
    // backfilled DB-side from SYSDATE on insert (see FspService.create).
    SubmissionPreview.TermAndDates termAndDates = plan == null
        ? new SubmissionPreview.TermAndDates(null, null, null, null, null)
        : new SubmissionPreview.TermAndDates(
            null,
            plan.getPlanTermYears(),
            plan.getPlanTermMonths(),
            asString(plan.getPlanTermExpiry()),
            plan.getAmendmentComment());

    return new SubmissionPreview(
        metadata,
        header,
        termAndDates,
        toAgreementHolders(plan == null ? null : plan.getPlanHolderList()),
        toDistricts(plan == null ? null : plan.getDistrictCodeList()),
        toFduSummaries(plan == null ? null : plan.getFduList()),
        toIdentifiedAreaSummaries(plan == null ? null : plan.getIdentifiedAreasList()),
        toStockingStandardSummaries(plan == null ? null : plan.getStockingStandards()));
  }

  // ── Code resolvers ───────────────────────────────────────────────

  /**
   * Resolves each plan-holder client number against FOREST_CLIENT via
   * {@code PKG_SIL21_CLIENT_SEARCH.get_client_search}. One proc call per
   * holder — typical submissions carry 1–5, so the overhead is small.
   * Misses (client not found, proc error) leave {@code clientName=null}
   * so the preview still renders the bare number.
   */
  private List<SubmissionPreview.AgreementHolderRef> toAgreementHolders(
      PlanHolderAssociationType list) {
    if (list == null || list.getClientCode() == null) return List.of();
    return list.getClientCode().stream()
        .filter(c -> c != null && !c.isBlank())
        .map(code -> new SubmissionPreview.AgreementHolderRef(code, resolveClientName(code)))
        .toList();
  }

  private String resolveClientName(String clientNumber) {
    try {
      List<Sil21ClientSearchDao.Row> rows = clientSearchDao.getClientSearch(
          clientNumber, null, null, null, null);
      return rows.isEmpty() ? null : rows.get(0).clientName();
    } catch (RuntimeException e) {
      log.debug("Client lookup failed for {} — leaving name unresolved", clientNumber, e);
      return null;
    }
  }

  /**
   * Resolves each district code (e.g. "DMK") into {@code org_unit_no} +
   * {@code org_unit_name} using a one-shot read of the full ORG_UNIT
   * cursor (single proc call, cached as a local map). Unknown codes
   * pass through with null lookups — persistence will catch them.
   */
  private List<SubmissionPreview.DistrictRef> toDistricts(DistrictCodeAssociationType list) {
    if (list == null || list.getDistrictCode() == null) return List.of();
    Map<String, OrgUnitInfo> byCode = orgUnitsByCode();
    return list.getDistrictCode().stream()
        .filter(c -> c != null && !c.isBlank())
        .map(code -> {
          OrgUnitInfo info = byCode.get(code);
          return new SubmissionPreview.DistrictRef(
              code,
              info == null ? null : info.orgUnitNo(),
              info == null ? null : info.orgUnitName());
        })
        .toList();
  }

  private Map<String, OrgUnitInfo> orgUnitsByCode() {
    Map<String, OrgUnitInfo> out = new HashMap<>();
    try {
      List<Map<String, Object>> rows = codeListsDao.getOrgUnitFiltered("");
      for (Map<String, Object> row : rows) {
        // The cursor's column aliases are misleading: it returns
        //   code        → ORG_UNIT_NO          (the numeric id, not the code)
        //   description → ORG_UNIT_CODE ' - ' ORG_UNIT_NAME
        //   effective_date, expiry_date
        // — verified in FSP_CODE_LISTS.get_org_unit_filtered. Read by
        // position (matches CodeListsService.toCodeOption's positional
        // fallback) so a driver-side case / alias change can't break it,
        // then split the description on " - " to recover the real code
        // and the human name. Keep the full description as the name
        // fallback so districts that don't follow the convention still
        // render something useful.
        List<Object> values = List.copyOf(row.values());
        String orgUnitNo = values.size() > 0 ? blankToNull(values.get(0)) : null;
        String description = values.size() > 1 ? blankToNull(values.get(1)) : null;
        if (description == null) continue;
        int sep = description.indexOf(" - ");
        String code = sep > 0 ? description.substring(0, sep).trim() : description.trim();
        String name = sep > 0 ? description.substring(sep + 3).trim() : description.trim();
        out.put(code, new OrgUnitInfo(orgUnitNo, name));
      }
    } catch (RuntimeException e) {
      log.debug("Org-units lookup failed — districts will render with code only", e);
    }
    return out;
  }

  private static String blankToNull(Object o) {
    if (o == null) return null;
    String s = o.toString().trim();
    return s.isEmpty() ? null : s;
  }

  private record OrgUnitInfo(String orgUnitNo, String orgUnitName) {}

  private static String firstNonBlank(Map<String, Object> row, String... keys) {
    for (String key : keys) {
      Object v = row.get(key);
      if (v == null) continue;
      String s = v.toString().trim();
      if (!s.isEmpty()) return s;
    }
    return null;
  }

  private static List<SubmissionPreview.FduSummary> toFduSummaries(FDUAssociationType list) {
    if (list == null || list.getFdu() == null) return List.of();
    return list.getFdu().stream()
        .filter(java.util.Objects::nonNull)
        .map(SubmissionPreviewMapper::toFduSummary)
        .toList();
  }

  private static SubmissionPreview.FduSummary toFduSummary(FDUType fdu) {
    int licenceCount = fdu.getLicenceList() == null || fdu.getLicenceList().getLicenceNumber() == null
        ? 0
        : fdu.getLicenceList().getLicenceNumber().size();
    PolygonStats geom = extentStats(fdu.getExtentOf());
    return new SubmissionPreview.FduSummary(
        fdu.getFduName(),
        licenceCount,
        geom.polygonCount(),
        geom.srsName());
  }

  private static List<SubmissionPreview.IdentifiedAreaSummary> toIdentifiedAreaSummaries(
      IdentifiedAreaAssociationType list) {
    if (list == null || list.getIdentifiedArea() == null) return List.of();
    return list.getIdentifiedArea().stream()
        .filter(java.util.Objects::nonNull)
        .map(SubmissionPreviewMapper::toIdentifiedAreaSummary)
        .toList();
  }

  private static SubmissionPreview.IdentifiedAreaSummary toIdentifiedAreaSummary(IdentifiedAreaType area) {
    PolygonStats geom = extentStats(area.getExtentOf());
    return new SubmissionPreview.IdentifiedAreaSummary(
        area.getIdentifiedAreaName(),
        area.getLegislationTypeCode(),
        geom.polygonCount(),
        geom.srsName());
  }

  private static List<SubmissionPreview.StockingStandardSummary> toStockingStandardSummaries(
      StandardsAssociationType standards) {
    if (standards == null || standards.getNewFSPStandardsList() == null
        || standards.getNewFSPStandardsList().getFSPStandard() == null) {
      return List.of();
    }
    return standards.getNewFSPStandardsList().getFSPStandard().stream()
        .filter(java.util.Objects::nonNull)
        .map(SubmissionPreviewMapper::toStockingStandardSummary)
        .toList();
  }

  private static SubmissionPreview.StockingStandardSummary toStockingStandardSummary(
      FSPStandardsType s) {
    int layerCount = s.getStandardLayerList() == null ? 0 : s.getStandardLayerList().size();

    // The XML carries a BGCAssociationListType per regime; each list
    // wraps one or more BGCType entries. Flatten into a CSV of
    // "Zone Subzone Variant" labels (matching the FSP Stocking
    // Standards table's BGC column format) and surface the count
    // alongside.
    List<String> bgcLabels = new java.util.ArrayList<>();
    if (s.getBgcList() != null) {
      for (var assoc : s.getBgcList()) {
        if (assoc == null || assoc.getBgc() == null) continue;
        for (var bgc : assoc.getBgc()) {
          if (bgc == null) continue;
          String label = bgcLabel(bgc);
          if (label != null && !label.isBlank()) bgcLabels.add(label);
        }
      }
    }
    String bgcSummary = bgcLabels.isEmpty() ? null : String.join(", ", bgcLabels);

    String idText = s.getLicenseeStandardsRegimeID() == null
        ? null : String.valueOf(s.getLicenseeStandardsRegimeID());

    return new SubmissionPreview.StockingStandardSummary(
        idText,
        s.getStandardsRegimeName(),
        s.getStandardsObjective(),
        bgcSummary,
        bgcLabels.size(),
        layerCount);
  }

  /** "CWH dm 1" or "IDFdk3" depending on which subfields are populated. */
  private static String bgcLabel(
      ca.bc.gov.nrs.fsp.api.submission.parser.generated.BGCType bgc) {
    StringBuilder sb = new StringBuilder();
    appendIfPresent(sb, bgc.getBgcZone(), null);
    appendIfPresent(sb, bgc.getBgcSubzone(), null);
    appendIfPresent(sb, bgc.getBgcVariant(), null);
    return sb.length() == 0 ? null : sb.toString();
  }

  private static void appendIfPresent(StringBuilder sb, String value, String separator) {
    if (value == null || value.isBlank()) return;
    if (sb.length() > 0 && separator != null) sb.append(separator);
    sb.append(value.trim());
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Extracts polygon count + SRS name from a GML extent without
   * converting to JTS — pure structural inspection. Geometry topology
   * validation runs separately in GeometryValidator.
   */
  private record PolygonStats(int polygonCount, String srsName) {}

  private static PolygonStats extentStats(SingleOrMultiplePolygonPropertyType extent) {
    if (extent == null || extent.getGeometry() == null) {
      return new PolygonStats(0, null);
    }
    Object geom = extent.getGeometry().getValue();
    if (geom instanceof MultiPolygonType multi) {
      int count = multi.getGeometryMember() == null ? 0 : multi.getGeometryMember().size();
      return new PolygonStats(count, multi.getSrsName());
    }
    if (geom instanceof PolygonType poly) {
      return new PolygonStats(1, poly.getSrsName());
    }
    return new PolygonStats(0, null);
  }

  private static ForestStewardshipPlanType unwrapPlan(FSPSubmissionType submission) {
    if (submission == null || submission.getSubmissionItem() == null) return null;
    return submission.getSubmissionItem().getForestStewardshipPlan();
  }

  private static String asString(Object value) {
    return value == null ? null : value.toString();
  }

  private static String asString(XMLGregorianCalendar c) {
    return c == null ? null : c.toString();
  }

  private static <T> T jaxbValue(JAXBElement<T> el) {
    return el == null ? null : el.getValue();
  }

  /** Pretty translation of the XML's actionCode for UI display. */
  private static String describeActionCode(ActionCodeType code) {
    if (code == null) return null;
    return switch (code) {
      case I -> "Initial submission";
      case U -> "Update (draft)";
      case A -> "Amendment";
      case R -> "Replacement";
    };
  }
}
