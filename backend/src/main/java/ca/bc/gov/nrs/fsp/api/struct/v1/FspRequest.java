package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

import java.util.List;

/**
 * FSP detail (subset of fsp_300_information.MAINLINE INOUT params). Field names
 * mirror the P_* parameters of the legacy package (lowercased). All values are
 * VARCHAR in the source — kept as String here for fidelity.
 */
@Data
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class FspRequest extends BaseRequest {

  private String fspId;
  private String newFspId;
  private String fspPlanName;
  private String fspStatusCode;
  private String fspStatusDesc;
  private String fspAmendmentNumber;
  private String newFspAmendmentNumber;
  private String userClientNumber;
  private String userRole;
  private String submissionId;
  private String fspExpiryDate;
  private String amendmentName;
  private String amendmentEfftvDate;
  private String fspPlanStartDate;
  private String fspPlanTermYears;
  private String fspPlanTermMonths;
  private String fspPlanEndDate;
  private String fspPlanSubmissionDate;
  private String fspContactName;
  private String fspTelephoneNumber;
  private String fspEmailAddress;
  private String fduUpdateInd;
  private String identifiedAreasUpdateInd;
  private String stockingStandardUpdateInd;
  private String approvalRequiredInd;
  private String transitionInd;
  private String frpa197electionInd;
  private String amendmentAuthority;
  private String amendmentReason;
  private String fspRejectedByEsfInd;
  private String fspUnapprovedAmendsInd;
  private String fspExtensionStat;
  private String fspAmendmentCode;
  private String fspAmendmentDesc;
  private String revisionCount;

  // Populated on the read path from the FSP_300_INFORMATION.MAINLINE
  // VARRAY out-params (P_FSP_LICENSES, P_ORG_UNITS). Left null on
  // request bodies the client posts back — the proc reads them as
  // null and treats the existing rows as unchanged.
  private List<AgreementHolder> agreementHolders;
  private List<District> districts;

  /** One row of the licensees VARRAY (THE.FSP_300_LICENSEE_OBJECT). */
  @Data
  @NoArgsConstructor
  @AllArgsConstructor
  public static class AgreementHolder {
    private String clientNumber;
    private String clientName;
    private String agreementDescription;
  }

  /** One row of the org-units VARRAY (THE.FSP_ORG_UNIT_OBJECT). */
  @Data
  @NoArgsConstructor
  @AllArgsConstructor
  public static class District {
    private String orgUnitNo;
    private String orgUnitCode;
    private String orgUnitName;
  }
}
