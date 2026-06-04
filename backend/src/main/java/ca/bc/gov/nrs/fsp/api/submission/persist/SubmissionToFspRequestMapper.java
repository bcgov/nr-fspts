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
        .fspPlanTermYears(asString(plan.getPlanTermYears()))
        .fspPlanTermMonths(asString(plan.getPlanTermMonths()))
        .fspExpiryDate(asString(plan.getPlanTermExpiry()))
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
   * Translate the XML's {@code actionCode} (I/U/A) into the legacy
   * DB's {@code fsp_amendment_code} (ORG/AMD/...). They look similar
   * but they're entirely different vocabularies:
   *
   * <ul>
   *   <li>XML actionCode = submission intent: <b>I</b>nitial / <b>U</b>pdate-draft / <b>A</b>mendment</li>
   *   <li>DB fsp_amendment_code = row category in the lookup table
   *       {@code fsp_amendment_code} (FK from {@code forest_stewardship_plan}):
   *       <b>ORG</b> (original), <b>AMD</b> (amendment), <b>RPL</b> (replace), etc.</li>
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
    };
  }
}
