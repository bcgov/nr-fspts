package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import jakarta.xml.bind.JAXBElement;
import org.springframework.stereotype.Component;

import javax.xml.datatype.XMLGregorianCalendar;
import java.util.List;

/**
 * Translates the JAXB-parsed FSP submission into the existing
 * {@link FspRequest} DTO that {@code FspService.update()} consumes.
 * Phase 2 Increment 1: header (FSP_300) fields only. FDU geometry,
 * identified areas, stocking standards, and attachments are mapped in
 * later increments via their own services.
 */
@Component
public class SubmissionToFspRequestMapper {

  public FspRequest toFspRequest(FSPSubmissionType submission) {
    ForestStewardshipPlanType plan = unwrapPlan(submission);
    if (plan == null) {
      throw new IllegalStateException(
          "submission does not contain a forestStewardshipPlan body");
    }
    FSPSubmissionMetadataType meta = submission.getFspSubmissionMetadata();

    return FspRequest.builder()
        .fspId(asString(plan.getFspID()))
        .fspAmendmentNumber(asString(plan.getAmendmentID()))
        .fspPlanName(plan.getPlanName())
        .amendmentName(jaxbValue(plan.getLicenseeAmendmentName()))
        // Plan term and end-date are mutually exclusive at the proc
        // (FSP.BOTH.PLAN.TERM_OR_END_DATE), and PlanTermValidator already
        // caught any XML that supplied both. Two non-obvious moves here:
        //
        // 1. <planTermExpiry> maps to fspPlanEndDate (proc position 21,
        //    p_fsp_plan_end_date — the write-side plan_end_date column),
        //    NOT fspExpiryDate (position 13, p_fsp_expiry_date — a
        //    tombstone-output FSP-level expiry from fsp_extension that
        //    SAVE never reads).
        //
        // 2. Empty-string the unused side so FspService.update()'s
        //    GET→applyEdits→SAVE merge doesn't carry forward the
        //    fsp_create_amendment-copied plan_end_date when the XML
        //    supplies term, or carry forward years/months when the XML
        //    supplies expiry. applyEdits treats null as "no change", so
        //    "" is the only way to force a clear through the merge.
        .fspPlanTermYears(planTermYearsForRequest(plan))
        .fspPlanTermMonths(planTermMonthsForRequest(plan))
        .fspPlanEndDate(planEndDateForRequest(plan))
        .amendmentReason(plan.getAmendmentComment())
        .approvalRequiredInd(boolToInd(jaxbValue(plan.getAmendmentApprovalRequiredInd())))
        .fspAmendmentCode(mapActionCode(plan.getActionCode()))
        // Contact details live on fspSubmissionMetadata at the envelope level,
        // not under forestStewardshipPlan, so pull from there.
        .fspContactName(meta == null ? null : meta.getLicenseeContact())
        .fspTelephoneNumber(meta == null ? null : meta.getTelephoneNumber())
        .fspEmailAddress(meta == null ? null : meta.getEmailAddress())
        // VARRAY contents the proc's SAVE branch validates against
        // (at least one agreement holder is required, otherwise the
        // proc returns FSP.NO.AGREEMENT.HOLDER).
        .agreementHolders(toAgreementHolders(plan.getPlanHolderList()))
        .districts(toDistricts(plan.getDistrictCodeList()))
        // Update-indicators consumed by both AMEND (to seed the
        // amendment row) and SAVE (to track what changed). XSD types
        // these as xs:boolean → JAXB exposes them as is*() getters
        // returning Boolean (nullable); proc expects 'Y'/'N'.
        .fduUpdateInd(boolToInd(plan.isFduUpdateInd()))
        .identifiedAreasUpdateInd(boolToInd(plan.isIdentifiedAreasUpdateInd()))
        .stockingStandardUpdateInd(boolToInd(plan.isStockingStandardUpdateInd()))
        .transitionInd(boolToInd(plan.isTransitionalInd()))
        .frpa197electionInd(boolToInd(plan.isFrpa197Ind()))
        .build();
  }


  private static List<FspRequest.AgreementHolder> toAgreementHolders(
      PlanHolderAssociationType list) {
    if (list == null || list.getClientCode() == null) {
      return List.of();
    }
    // XML only carries the client number — name + agreement description
    // are looked up downstream by the proc (it joins to FOREST_CLIENT
    // for display) so we send the code in the structural position and
    // let the proc resolve the rest.
    return list.getClientCode().stream()
        .filter(code -> code != null && !code.isBlank())
        .map(code -> new FspRequest.AgreementHolder(code, null, null))
        .toList();
  }

  private static List<FspRequest.District> toDistricts(DistrictCodeAssociationType list) {
    if (list == null || list.getDistrictCode() == null) {
      return List.of();
    }
    return list.getDistrictCode().stream()
        .filter(code -> code != null && !code.isBlank())
        .map(code -> new FspRequest.District(null, code, null))
        .toList();
  }

  private static ForestStewardshipPlanType unwrapPlan(FSPSubmissionType submission) {
    if (submission == null || submission.getSubmissionItem() == null) {
      return null;
    }
    return submission.getSubmissionItem().getForestStewardshipPlan();
  }

  /**
   * Returns the XML's planTermYears as a string, or "" if the XML
   * supplied a planTermExpiry instead (forcing the merge to clear any
   * carried-forward term on the new amendment).
   */
  private static String planTermYearsForRequest(ForestStewardshipPlanType plan) {
    if (plan.getPlanTermExpiry() != null) return "";
    return asString(plan.getPlanTermYears());
  }

  /**
   * Returns the XML's planTermMonths as a string, or "" if the XML
   * supplied a planTermExpiry instead.
   */
  private static String planTermMonthsForRequest(ForestStewardshipPlanType plan) {
    if (plan.getPlanTermExpiry() != null) return "";
    return asString(plan.getPlanTermMonths());
  }

  /**
   * Returns the XML's planTermExpiry as a string, or "" if the XML
   * supplied a term instead (forcing the merge to clear any
   * carried-forward plan_end_date).
   */
  private static String planEndDateForRequest(ForestStewardshipPlanType plan) {
    boolean hasTerm = plan.getPlanTermYears() != null || plan.getPlanTermMonths() != null;
    if (hasTerm) return "";
    return asString(plan.getPlanTermExpiry());
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

  /**
   * Legacy FSP_300_INFORMATION expects 'Y'/'N' indicators where the XML
   * carries an xsd:boolean.
   */
  private static String boolToInd(Boolean value) {
    if (value == null) {
      return null;
    }
    return value ? "Y" : "N";
  }

  /**
   * Translate the XML's {@code actionCode} (I/U/A/R) into the legacy
   * DB's {@code fsp_amendment_code} (ORG/AMD/RPL). They look similar
   * but they're entirely different vocabularies:
   *
   * <ul>
   *   <li>XML actionCode = submission intent: <b>I</b>nitial / <b>U</b>pdate-draft /
   *       <b>A</b>mendment / <b>R</b>eplacement</li>
   *   <li>DB fsp_amendment_code = row category in the lookup table
   *       {@code fsp_amendment_code} (FK from {@code forest_stewardship_plan}):
   *       <b>ORG</b> (original), <b>AMD</b> (amendment), <b>RPL</b> (replace).</li>
   * </ul>
   *
   * <p>Passing "I" through unchanged trips the FK lookup in the GET
   * path's tombstone SELECT — the FSP becomes uncreatable to view.
   *
   * <p>{@code U} maps the same as I because U-on-draft is still an
   * original row, not an amendment.
   */
  private static String mapActionCode(ActionCodeType code) {
    if (code == null) {
      return null;
    }
    return switch (code) {
      case I, U -> "ORG";
      case A -> "AMD";
      case R -> "RPL";
    };
  }
}
