package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp700WorkflowDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp800HistoryDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowState;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * /workflow GET reuses FSP_800_HISTORY (legacy app's audit cursor); workflow
 * action submission goes through FSP_700_WORKFLOW.MAINLINE — 70 INOUT params,
 * almost all unused for a single-action submit. Empty strings for the
 * extensive milestone fields and the proc applies the action dispatch.
 *
 * <p>/workflow-state GET also goes through FSP_700_WORKFLOW.MAINLINE
 * (P_ACTION='GET') and projects the milestone / OTBH / DDM-decision /
 * extension-decision OUT params into a structured {@link WorkflowState} DTO
 * for the Workflow tab.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WorkflowService {

  // FSP_800_HISTORY.MAINLINE dispatches on P_ACTION='GET'; the legacy
  // 'FETCH' string drops into the noRecordsFound branch. Same convention
  // as every other FSP_* package — see FspService for the full story.
  private static final String ACTION_GET = "GET";

  private final Fsp700WorkflowDao workflowDao;
  private final Fsp800HistoryDao historyDao;

  public List<WorkflowResponse> getWorkflow(String fspId) {
    // FSP id flows in via P_NEW_FSP_ID; P_FSP_ID + both amendment slots
    // stay blank so fsp_tombstone.get hits its "find latest accessible
    // amendment" branch. Audit-user context from the JWT.
    Fsp800HistoryDao.Result result = historyDao.mainline(
        ACTION_GET, "", fspId, "", null,
        "", "", "", "",
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        "", "", "", "", "");
    return result.rows().stream().map(row -> WorkflowResponse.builder()
        .amendmentNumber(row.amendmentNumber())
        .extensionNumber(row.extensionNumber())
        .eventDateTime(row.eventDateTime())
        .userId(row.userId())
        .event(row.event())
        .description(row.description())
        .approvalRequestIndicator(row.approvalRequestIndicator())
        .submissionId(row.submissionId())
        .build()).toList();
  }

  /**
   * FSP_700_WORKFLOW.MAINLINE with P_ACTION='GET' — pulls the review
   * milestones (FNR/RS/ORS/DDM/OTHER), OTBH offered/heard, DDM decision,
   * and the first non-rejected extension request. Binding follows the same
   * P_FSP_ID-blank / P_NEW_FSP_ID-populated convention as FSP_300 GET so
   * fsp_tombstone.get resolves the latest accessible amendment.
   */
  public WorkflowState getWorkflowState(String fspId) {
    Fsp700WorkflowDao.Result r = workflowDao.mainline(
        ACTION_GET,
        fspId,                    // P_NEW_FSP_ID
        "",                       // P_FSP_ID (blank on GET; proc echoes back)
        "",                       // P_FSP_PLAN_NAME
        List.of(),                // P_FSP_ORG_UNITS (empty VARRAY, not null)
        "", "",                   // status code/desc
        "", "",                   // amendment code/desc
        "",                       // P_NEW_FSP_AMENDMENT_NUMBER (blank → latest)
        "",                       // P_FSP_AMENDMENT_NUMBER
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        "",                       // P_SUBMISSION_ID
        "",                       // P_FSP_EXPIRY_DATE
        "", "",                   // amendment name / efftv date
        // FNR / RS / ORS / DDM / OTHER milestone fields (5 × 5 = 25)
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "",                        // P_ENABLE_EXTENSION
        // OTBH offered/heard
        "", "", "", "",
        // DDM_ONLY (status, name, decision date, comment, submission, effective)
        "", "", "", "", "", "",
        // EXTENSION (status, id, name, decision, comment, submission, effective)
        "", "", "", "", "", "", "",
        // milestone summary (write-only)
        "", "",
        // dates (write-only)
        "", "", "", "",
        "",                        // P_REVIEW_COMMENT
        RequestUtil.getCurrentIdir(),
        ""                         // P_EXTENSION_IDS
    );

    List<WorkflowState.ReviewItem> reviewItems = List.of(
        new WorkflowState.ReviewItem(
            "FNR", "First Nations Review",
            r.pFnrCompletedInd(), r.pFnrEntryUserId(),
            r.pFnrEntryTimestamp(), r.pFnrComment()),
        new WorkflowState.ReviewItem(
            "RS", "Results & Strategies reviewed by C&E",
            r.pRsCompletedInd(), r.pRsEntryUserId(),
            r.pRsEntryTimestamp(), r.pRsComment()),
        new WorkflowState.ReviewItem(
            "ORS", "Objectives, Results and Strategies reviewed by Tenures",
            r.pOrsCompletedInd(), r.pOrsEntryUserId(),
            r.pOrsEntryTimestamp(), r.pOrsComment()),
        new WorkflowState.ReviewItem(
            "DDM", "Sent to DDM for Determination",
            r.pDdmCompletedInd(), r.pDdmEntryUserId(),
            r.pDdmEntryTimestamp(), r.pDdmComment()),
        new WorkflowState.ReviewItem(
            "OTHER", "Other",
            r.pOtherCompletedInd(), r.pOtherEntryUserId(),
            r.pOtherEntryTimestamp(), r.pOtherComment())
    );

    return new WorkflowState(
        nz(r.pNewFspId()).isEmpty() ? r.pFspId() : r.pNewFspId(),
        nz(r.pFspAmendmentNumber()).isEmpty()
            ? r.pNewFspAmendmentNumber()
            : r.pFspAmendmentNumber(),
        r.pFspStatusCode(),
        r.pFspStatusDesc(),
        reviewItems,
        new WorkflowState.Otbh(
            r.pOtbhOfferedDate(),
            r.pOtbhOfferedComment(),
            r.pOtbhHeardDate(),
            r.pOtbhHeardComment()),
        new WorkflowState.DdmDecision(
            r.pDdmOnlyStatusCode(),
            r.pDdmOnlyName(),
            r.pDdmOnlySubmissionDate(),
            r.pDdmOnlyDecisionDate(),
            r.pDdmOnlyEffectiveDate(),
            r.pDdmOnlyComment()),
        new WorkflowState.ExtensionDecision(
            r.pExtensionStatusCode(),
            r.pExtensionId(),
            r.pExtensionName(),
            r.pExtensionSubmissionDate(),
            r.pExtensionDecisionDate(),
            r.pExtensionEffectiveDate(),
            r.pExtensionComment()),
        r.pExtensionIds()
    );
  }

  @Transactional
  public void submitAction(String fspId, WorkflowRequest request) {
    // Legacy audit columns are VARCHAR2(30); use the short FAM IDIR
    // (truncated) rather than the 46-char Cognito composite.
    String userId = RequestUtil.getCurrentIdir();
    workflowDao.mainline(
        request.getAction(),     // P_ACTION
        "",                       // P_NEW_FSP_ID
        fspId,                    // P_FSP_ID
        "",                       // P_FSP_PLAN_NAME
        null,                     // P_FSP_ORG_UNITS
        "", "",                   // status code/desc
        "", "",                   // amendment code/desc
        "",                       // P_NEW_FSP_AMENDMENT_NUMBER
        "",                       // P_FSP_AMENDMENT_NUMBER
        "", "",                   // user client number / user role
        "",                       // P_SUBMISSION_ID
        "",                       // P_FSP_EXPIRY_DATE
        "", "",                   // amendment name / efftv date
        // FNR / RS / ORS / DDM / OTHER milestone fields (5 × 5 = 25)
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "",                        // P_ENABLE_EXTENSION
        // OTBH offered/heard
        "", "", "", "",
        // DDM_ONLY
        "", "", "", "", "", "",
        // EXTENSION
        "", "", "", "", "", "", "",
        // milestone summary
        "", "",
        // dates
        "", "", "", "",
        request.getComments(),     // P_REVIEW_COMMENT
        userId,                    // p_UPDATE_USERID
        ""                         // P_EXTENSION_IDS
    );
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
