package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp700WorkflowDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp800HistoryDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowResponse;
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
}
