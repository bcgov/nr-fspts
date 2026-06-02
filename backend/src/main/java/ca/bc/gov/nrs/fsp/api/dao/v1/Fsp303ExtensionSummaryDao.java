package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps THE.FSP_303_EXTENSION_SUMMARY.GET_LIST — the read-only "summary
 * of extension requests" view for an FSP. Returns the FSP-level
 * tombstone fields the screen renders at the top, plus the per-row
 * extension records from the cursor.
 */
public interface Fsp303ExtensionSummaryDao {

  String PACKAGE_NAME = "FSP_303_EXTENSION_SUMMARY";
  String PROCEDURE_NAME = "GET_LIST";

  Result getList(String fspId, String userClientNumber, String userRole, String userId);

  record Result(
      String fspId,
      String fspPlanName,
      String originalEffectiveDate,
      String originalExpiryDate,
      String currentPlanTermYears,
      String currentPlanTermMonths,
      String currentExpiryDate,
      List<ExtensionRow> extensions,
      String errorMessage
  ) {}

  /** One row of the p_extensions cursor (matches the OPEN-FOR list in the proc body). */
  record ExtensionRow(
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
