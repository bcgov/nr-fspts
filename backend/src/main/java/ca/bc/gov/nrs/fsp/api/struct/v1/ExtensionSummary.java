package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Read-only projection of FSP_303_EXTENSION_SUMMARY.GET_LIST for the
 * Extension Summary page. Carries the FSP tombstone fields the page
 * renders at the top plus the list of extension requests with their
 * status, term, and decision dates.
 */
public record ExtensionSummary(
    String fspId,
    String fspPlanName,
    String originalEffectiveDate,
    String originalExpiryDate,
    String currentPlanTermYears,
    String currentPlanTermMonths,
    String currentExpiryDate,
    List<Extension> extensions
) {

  public record Extension(
      String extensionId,
      String extensionNumber,
      String statusCode,
      String statusDescription,
      String planTermYears,
      String planTermMonths,
      String planStartDate,
      String planEndDate,
      String submissionDate,
      String decisionDate,
      String approvalDate,
      String rejectDate,
      String fspAmendmentNumber,
      String statusComment
  ) {}
}
