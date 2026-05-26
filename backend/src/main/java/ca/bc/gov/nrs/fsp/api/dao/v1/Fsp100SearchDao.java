package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps Oracle package FSP_100_SEARCH (legacy: pkgdefinitions/Fsp100Search.java).
 * Procedure name and parameter order mirror the legacy descriptor verbatim.
 */
public interface Fsp100SearchDao {

  String PACKAGE_NAME = "FSP_100_SEARCH";
  String PROCEDURE_NAME = "MAINLINE";

  /** Echoed-back INOUT VARCHARs from the call (positions 1..14, plus #16 P_ERROR_MESSAGE). */
  record Header(
      String pAction,
      String pFspId,
      String pFspPlanName,
      String pOrgUnitNo,
      String pAhClientNumber,
      String pFspAmendmentName,
      String pEntryUserClientNumber,
      String pEntryUserid,
      String pEntryUserRole,
      String pFspDateStart,
      String pFspDateEnd,
      String pFspDateType,
      String pFspStatusCode,
      String pApprovalRequired,
      String pErrorMessage
  ) {}

  /** P_FSP_SEARCH_RESULT REF CURSOR row (10 columns, all VARCHAR). */
  record Row(
      String fspId,
      String planName,
      String fspAmendmentName,
      String orgUnitCode,
      String planStartDate,
      String planEndDate,
      String fspAmendmentNumber,
      String agreementHolder,
      String amendmentApprovalRequirdInd,
      String fspStatusDesc
  ) {}

  record Result(Header header, List<Row> rows) {}

  /**
   * @param maxRows upper bound on rows drained from the REF CURSOR. Use
   *     a positive value for paged reads (typically {@code (page+1)*size + 1}
   *     to detect hasNext); 0 or negative drains the whole cursor
   *     (legacy behavior — only use when the result set is known small).
   */
  Result mainline(
      String pAction,
      String pFspId,
      String pFspPlanName,
      String pOrgUnitNo,
      String pAhClientNumber,
      String pFspAmendmentName,
      String pEntryUserClientNumber,
      String pEntryUserid,
      String pEntryUserRole,
      String pFspDateStart,
      String pFspDateEnd,
      String pFspDateType,
      String pFspStatusCode,
      String pApprovalRequired,
      int maxRows
  );
}
