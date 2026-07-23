package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp700WorkflowDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp800HistoryDao;
import ca.bc.gov.nrs.fsp.api.notification.EmailNotificationService;
import ca.bc.gov.nrs.fsp.api.notification.WorkflowEmailEvent;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowState;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

  // Actions that may trigger a workflow email (legacy section/item
  // combinations from Fsp700WorkflowAction.java:391-445). Used to gate
  // the BEFORE-save status fetch and to short-circuit publishEmailFor.
  private static final Set<String> EMAIL_TRIGGERING_ACTIONS = Set.of(
      "SAVE_OTBH_HEARD",
      "SAVE_DDM_DFT",
      "SAVE_DDM_APP",
      "SAVE_DDM_REJ",
      "SAVE_EXT_APP",
      "SAVE_EXT_REJ");

  private final Fsp700WorkflowDao workflowDao;
  private final Fsp800HistoryDao historyDao;
  private final FspService fspService;
  private final EmailNotificationService emailService;
  private final ca.bc.gov.nrs.fsp.api.dao.v1.FspWorkflowQueryDao workflowQueryDao;

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
   * P_FSP_ID-blank / P_NEW_FSP_ID-populated convention as FSP_300 GET.
   *
   * @param amendmentNumber the amendment/version to read. Blank/null lets
   *     fsp_tombstone.get resolve the latest accessible amendment; a
   *     specific value scopes the read (including get_ddm_only's decision
   *     lookup) to that version, so viewing an earlier approved amendment
   *     shows ITS decision instead of the latest draft's empty one.
   */
  public WorkflowState getWorkflowState(String fspId, String amendmentNumber) {
    Fsp700WorkflowDao.Result r = workflowDao.mainline(
        ACTION_GET,
        fspId,                    // P_NEW_FSP_ID
        "",                       // P_FSP_ID (blank on GET; proc echoes back)
        "",                       // P_FSP_PLAN_NAME
        List.of(),                // P_FSP_ORG_UNITS (empty VARRAY, not null)
        "", "",                   // status code/desc
        "", "",                   // amendment code/desc
        nz(amendmentNumber),      // P_NEW_FSP_AMENDMENT_NUMBER (blank = latest)
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
            "FNR", "First Nations review",
            r.pFnrCompletedInd(), r.pFnrEntryUserId(),
            r.pFnrEntryTimestamp(), r.pFnrComment()),
        new WorkflowState.ReviewItem(
            "RS", "Results & strategies reviewed",
            r.pRsCompletedInd(), r.pRsEntryUserId(),
            r.pRsEntryTimestamp(), r.pRsComment()),
        new WorkflowState.ReviewItem(
            "ORS", "Objectives, results and strategies reviewed by Tenures",
            r.pOrsCompletedInd(), r.pOrsEntryUserId(),
            r.pOrsEntryTimestamp(), r.pOrsComment()),
        new WorkflowState.ReviewItem(
            "DDM", "Sent to DDM for determination",
            r.pDdmCompletedInd(), r.pDdmEntryUserId(),
            r.pDdmEntryTimestamp(), r.pDdmComment()),
        new WorkflowState.ReviewItem(
            "OTHER", "Other",
            r.pOtherCompletedInd(), r.pOtherEntryUserId(),
            r.pOtherEntryTimestamp(), r.pOtherComment())
    );

    String resolvedFspId =
        nz(r.pNewFspId()).isEmpty() ? r.pFspId() : r.pNewFspId();
    String resolvedAmendmentNumber =
        nz(r.pFspAmendmentNumber()).isEmpty()
            ? r.pNewFspAmendmentNumber()
            : r.pFspAmendmentNumber();

    WorkflowState.DdmDecision ddmDecision = new WorkflowState.DdmDecision(
        r.pDdmOnlyStatusCode(),
        r.pDdmOnlyName(),
        r.pDdmOnlySubmissionDate(),
        r.pDdmOnlyDecisionDate(),
        r.pDdmOnlyEffectiveDate(),
        r.pDdmOnlyComment());
    // The proc's get_ddm_only only returns a decision while the amendment's
    // current status still matches it. Once a newer amendment is approved
    // the prior one is retired (RET), and the proc goes silent — leaving the
    // tab showing "no decision recorded" on a version that WAS approved.
    // Fall back to the recorded status-history decision so a superseded /
    // retired version still shows what was decided on it.
    if (nz(ddmDecision.statusCode()).isEmpty()) {
      ddmDecision = ddmDecisionFallback(resolvedFspId, resolvedAmendmentNumber, ddmDecision);
    }

    // amendment_approval_date isn't returned by FSP_700 — read it app-side so
    // the DDM Decision tile can show it for an approved amendment.
    String amendmentApprovalDate =
        resolveAmendmentApprovalDate(resolvedFspId, resolvedAmendmentNumber);

    return new WorkflowState(
        resolvedFspId,
        resolvedAmendmentNumber,
        r.pFspStatusCode(),
        r.pFspStatusDesc(),
        r.pFspAmendmentCode(),
        r.pFspExpiryDate(),
        amendmentApprovalDate,
        reviewItems,
        new WorkflowState.Otbh(
            r.pOtbhOfferedDate(),
            r.pOtbhOfferedComment(),
            r.pOtbhHeardDate(),
            r.pOtbhHeardComment()),
        ddmDecision,
        new WorkflowState.ExtensionDecision(
            r.pExtensionStatusCode(),
            r.pExtensionId(),
            r.pExtensionName(),
            r.pExtensionSubmissionDate(),
            r.pExtensionDecisionDate(),
            r.pExtensionEffectiveDate(),
            r.pExtensionComment()),
        r.pExtensionIds(),
        new WorkflowState.Roles(
            RequestUtil.isCurrentUserReviewer(),
            RequestUtil.isCurrentUserDecisionMaker(),
            RequestUtil.isCurrentUserAdmin())
    );
  }

  /**
   * Submit one workflow mutation through FSP_700_WORKFLOW.MAINLINE and
   * return the refreshed projection so the Workflow tab redraws in one
   * round-trip. Only the fields the per-action dispatch actually reads
   * are threaded — everything else stays blank to avoid accidentally
   * overwriting unrelated columns.
   */
  @Transactional
  public WorkflowState submitAction(String fspId, WorkflowRequest request) {
    // Block the legacy "reverse decision" path. SAVE_DDM_* with
    // completed='N' was the proc-level undo branch that flipped the
    // FSP back from APP/INE/DFT/REJ to SUB. The SPA no longer exposes
    // this gesture (the Reverse Decision button was removed from the
    // DDM Decision dialog), so reject the same shape server-side to
    // keep stray API clients from re-introducing the flow.
    String requestedAction = nz(request.getAction());
    if (requestedAction.startsWith("SAVE_DDM_")
        && "N".equalsIgnoreCase(nz(request.getCompleted()))) {
      throw new IllegalArgumentException(
          "Reversing a DDM decision is no longer supported.");
    }

    // Prefixed form (IDIR\name / BCEID\name) so the workflow audit
    // history matches the legacy convention. FSP_700_WORKFLOW only
    // uses this value for audit columns — no proc-side joins on it.
    String userId = RequestUtil.getCurrentAuditUserId();
    String amendment = nz(request.getFspAmendmentNumber());

    // FSPTS Permission Matrix section D (client-confirmed 2026-07-06) — the
    // authoritative per-action / per-role / per-status workflow fence. The
    // endpoint gate (FspAuthorities.WORKFLOW_DECISION) admits only Admin / DM /
    // Reviewer; this narrows each action to the roles + status the matrix
    // allows. Fail-closed if the status can't be read.
    String currentStatusUpper = "";
    try {
      FspRequest current = fspService.getById(fspId, amendment);
      if (current != null) currentStatusUpper = nz(current.getFspStatusCode()).toUpperCase();
    } catch (RuntimeException e) {
      log.warn("Workflow authz could not read FSP {} status (failing closed): {}",
          fspId, e.getMessage());
    }
    assertWorkflowActionAllowed(requestedAction, currentStatusUpper);

    // Capture the PRE-save status code so publishEmailFor can apply the
    // legacy "DDM/admin just adjusting dates → don't email" guard. Done
    // here (inside the transaction, before the mutation) because after
    // the save the row already reflects the new status. Only loaded for
    // actions that could send mail, so non-emailing actions don't pay.
    //
    // Also reused for the post-approval lock below: once an FSP is in
    // APP (Approved) or INE (In Effect) we refuse SAVE_DDM_REJ and
    // SAVE_DDM_DFT — the decision-maker can edit the existing approval
    // but cannot pivot it into a rejection or clarification request.
    boolean approvalLockRelevant =
        "SAVE_DDM_REJ".equals(requestedAction)
            || "SAVE_DDM_DFT".equals(requestedAction);
    String oldStatusCode = "";
    if (EMAIL_TRIGGERING_ACTIONS.contains(nz(request.getAction()))
        || approvalLockRelevant) {
      try {
        FspRequest before = fspService.getById(fspId, amendment);
        if (before != null) oldStatusCode = nz(before.getFspStatusCode());
      } catch (RuntimeException e) {
        log.warn(
            "Pre-save FSP fetch for email guard failed (treating status as changed): {}",
            e.getMessage());
      }
    }

    if (approvalLockRelevant
        && ("APP".equalsIgnoreCase(oldStatusCode)
            || "INE".equalsIgnoreCase(oldStatusCode))) {
      throw new IllegalArgumentException(
          "Once an FSP has been approved, it cannot be rejected or "
              + "returned for clarification.");
    }

    workflowDao.mainline(
        request.getAction(),     // P_ACTION
        "",                       // P_NEW_FSP_ID
        fspId,                    // P_FSP_ID
        "",                       // P_FSP_PLAN_NAME
        null,                     // P_FSP_ORG_UNITS
        nz(request.getFspStatusCode()),    // P_FSP_STATUS_CODE — SAVE_DDM_* branches on it
        "",                                 // P_FSP_STATUS_DESC
        nz(request.getFspAmendmentCode()), // P_FSP_AMENDMENT_CODE — SAVE_DDM_APP needs it
        "",                                 // P_FSP_AMENDMENT_DESC
        "",                                 // P_NEW_FSP_AMENDMENT_NUMBER
        amendment,                          // P_FSP_AMENDMENT_NUMBER
        "", "",                             // user client number / user role
        "",                                 // P_SUBMISSION_ID
        "",                                 // P_FSP_EXPIRY_DATE
        "", "",                             // amendment name / efftv date
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
        // EXTENSION (status, id, name, decision date, comment, submission date, effective date)
        "", nz(request.getExtensionId()), "", "", "", "", "",
        // P_FSP_REVIEW_MILESTONE_TYP_CD + P_COMPLETED_IND
        nz(request.getMilestoneType()),
        nz(request.getCompleted()),
        // P_OTBH_DATE (SAVE_OTBH_*), then P_PLAN_START_DATE +
        // P_SUBMISSION_DATE + P_DECISION_DATE (SAVE_DDM_* / SAVE_EXT_*).
        // The OTBH date carries a wall-clock time so the date-sequence
        // guard inside fsp_status_update (R__06412_FSP_COMMON_DB.sql:1759)
        // doesn't flag a same-day Heard save as < an existing
        // SYSDATE-stamped Offered row. See buildOtbhTimestamp.
        buildOtbhTimestamp(request.getOtbhDate()),
        nz(request.getEffectiveDate()),    // P_PLAN_START_DATE
        nz(request.getSubmissionDate()),
        nz(request.getDecisionDate()),
        nz(request.getComments()),         // P_REVIEW_COMMENT
        userId,                             // p_UPDATE_USERID
        ""                                  // P_EXTENSION_IDS
    );
    log.info("Workflow action {} on fsp {} amendment {} by {} — "
            + "milestone={} completed={} otbhDate={} "
            + "submissionDate={} decisionDate={} effectiveDate={} "
            + "extensionId={}",
        request.getAction(), fspId, amendment, userId,
        request.getMilestoneType(), request.getCompleted(),
        request.getOtbhDate(), request.getSubmissionDate(),
        request.getDecisionDate(), request.getEffectiveDate(),
        request.getExtensionId());

    // Re-fetch fresh state for the response AND so the email snapshot
    // (built below) sees the post-save status. State also carries the
    // extension submitter / submission date the extension template needs.
    WorkflowState state = getWorkflowState(fspId, amendment);
    publishEmailFor(fspId, amendment, request, oldStatusCode, state);
    return state;
  }

  /**
   * Authoritative per-action workflow authorization — FSPTS Permission Matrix
   * section D (client-confirmed 2026-07-06). Effective role is single, so at
   * most one of the flags below is set. The matrix inverts the legacy model:
   *
   * <ul>
   *   <li><b>Review decisions</b> — {@code SAVE_REVIEW} (milestone/comments),
   *       {@code SAVE_DDM_REJ} (reject), {@code SAVE_OTBH_OFFERED},
   *       {@code SAVE_OTBH_HEARD} — belong to <b>Decision Maker + Reviewer</b>.
   *       <b>Administrator is excluded</b> from these.</li>
   *   <li>{@code SAVE_DDM_APP} (approve) — Administrator + Decision Maker +
   *       Reviewer (matrix revision post-[82] restored Admin's Approve; Reject
   *       stays DM/Reviewer only).</li>
   *   <li>{@code SAVE_DDM_DFT} (request clarification, back to Draft) —
   *       Administrator + Decision Maker + Reviewer.</li>
   *   <li>{@code SAVE_EXT_APP} / {@code SAVE_EXT_REJ} (extension decision) —
   *       Administrator + Decision Maker (Reviewer excluded).</li>
   * </ul>
   *
   * <p>plus the per-action status window: Approve / Reject / milestone /
   * request-clarification only while <b>Submitted</b>; Offer OTBH while
   * Submitted or Approved; Record OTBH heard only while Opportunity-to-be-Heard.
   * Extension decisions carry no extra status gate here (the frontend only
   * surfaces them once an extension row is open; the proc enforces the rest).
   *
   * <p>Submitter's matrix Y on Offer-OTBH + Reject is intentionally <b>NOT</b>
   * granted — held pending client clarification — and Submitters never reach
   * this method anyway (the endpoint gate excludes them). Throws
   * {@link IllegalArgumentException} (→ 400) on violation, matching the other
   * request-shape guards in this method.
   */
  private void assertWorkflowActionAllowed(String action, String statusUpper) {
    boolean isAdmin = RequestUtil.isCurrentUserAdmin();
    boolean isDm = RequestUtil.isCurrentUserDecisionMaker();
    boolean isReviewer = RequestUtil.isCurrentUserReviewer();
    // Review decisions are the Decision Maker + Reviewer domain; Admin is
    // dashed out of these cells in the matrix.
    boolean reviewDecider = isDm || isReviewer;

    switch (action) {
      case "SAVE_REVIEW" -> { // record review milestone / comments
        requireRole(reviewDecider, action, "a Decision Maker or Reviewer");
        requireStatus("SUB".equals(statusUpper), action, "Submitted");
      }
      case "SAVE_DDM_APP" -> { // approve — Admin + DM + Reviewer
        requireRole(isAdmin || reviewDecider, action,
            "an Administrator, Decision Maker or Reviewer");
        requireStatus("SUB".equals(statusUpper), action, "Submitted");
      }
      case "SAVE_DDM_REJ" -> { // reject — DM + Reviewer only (Admin excluded)
        requireRole(reviewDecider, action, "a Decision Maker or Reviewer");
        requireStatus("SUB".equals(statusUpper), action, "Submitted");
      }
      case "SAVE_DDM_DFT" -> { // request clarification (back to Draft)
        requireRole(isAdmin || reviewDecider, action,
            "an Administrator, Decision Maker or Reviewer");
        requireStatus("SUB".equals(statusUpper), action, "Submitted");
      }
      case "SAVE_OTBH_OFFERED" -> { // offer opportunity to be heard
        requireRole(reviewDecider, action, "a Decision Maker or Reviewer");
        requireStatus("SUB".equals(statusUpper) || "APP".equals(statusUpper),
            action, "Submitted or Approved");
      }
      case "SAVE_OTBH_HEARD" -> { // record OTBH heard
        requireRole(reviewDecider, action, "a Decision Maker or Reviewer");
        requireStatus("OHS".equals(statusUpper), action, "Opportunity to be Heard");
      }
      case "SAVE_EXT_APP", "SAVE_EXT_REJ" -> { // extension decision
        requireRole(isAdmin || isDm, action, "an Administrator or Decision Maker");
      }
      default -> {
        // No other action codes reach submitAction (the SPA emits only the
        // eight above). Leave unknown actions to the proc rather than
        // silently allowing a mislabelled decision.
      }
    }
  }

  private static void requireRole(boolean allowed, String action, String who) {
    if (!allowed) {
      throw new IllegalArgumentException(
          "This action (" + action + ") may only be taken by " + who + ".");
    }
  }

  private static void requireStatus(boolean allowed, String action, String statuses) {
    if (!allowed) {
      throw new IllegalArgumentException(
          "This action (" + action + ") is only valid while the plan is "
              + statuses + ".");
    }
  }

  /**
   * Mirrors the legacy {@code Fsp700WorkflowAction} email ladder
   * (lines 391-445 of the original). Each branch builds a
   * {@link WorkflowEmailEvent.FspSnapshot} from a fresh FSP_300 read +
   * one-line history blurb, then publishes through
   * {@link EmailNotificationService} — which defers the actual CHES
   * send until {@code AFTER_COMMIT} of this transaction.
   *
   * <p>Snapshot is captured here (not in the dispatcher) because the
   * dispatcher runs on the {@code emailExecutor} pool where the JWT
   * isn't present; reading the FSP from a background thread would 401.
   */
  private void publishEmailFor(
      String fspId,
      String amendment,
      WorkflowRequest request,
      String oldStatusCode,
      WorkflowState state) {
    if (!"Y".equals(request.getCompleted())) return;
    String action = nz(request.getAction());
    if (!EMAIL_TRIGGERING_ACTIONS.contains(action)) return;

    FspRequest fsp;
    try {
      fsp = fspService.getById(fspId, amendment);
    } catch (RuntimeException e) {
      log.warn(
          "Skipping {} email — failed to load FSP {}/{}: {}",
          action, fspId, amendment, e.getMessage());
      return;
    }
    if (fsp == null) {
      log.warn("Skipping {} email — FSP {}/{} not found post-save", action, fspId, amendment);
      return;
    }

    WorkflowEmailEvent.FspSnapshot snap = toSnapshot(fsp, firstHistoryLine(fspId));
    String amendmentNumber = nz(fsp.getFspAmendmentNumber());
    String amendmentCode = nz(fsp.getFspAmendmentCode());

    switch (action) {
      case "SAVE_OTBH_HEARD" ->
          emailService.publish(new WorkflowEmailEvent.OtbhHeard(snap));
      case "SAVE_DDM_DFT" ->
          emailService.publish(new WorkflowEmailEvent.RequestClarification(snap));
      case "SAVE_DDM_APP" -> {
        if (statusUnchanged(oldStatusCode, "APP")) return;
        publishDdmDecision(snap, amendmentNumber, amendmentCode);
      }
      case "SAVE_DDM_REJ" -> {
        if (statusUnchanged(oldStatusCode, "REJ")) return;
        publishDdmDecision(snap, amendmentNumber, amendmentCode);
      }
      case "SAVE_EXT_APP" -> {
        if (statusUnchanged(oldStatusCode, "APP")) return;
        publishExtensionDecision(snap, state);
      }
      case "SAVE_EXT_REJ" -> {
        if (statusUnchanged(oldStatusCode, "REJ")) return;
        publishExtensionDecision(snap, state);
      }
      default -> {
        // Unreachable — gated above by EMAIL_TRIGGERING_ACTIONS.
      }
    }
  }

  /** Amendment 0 → FspDecision, amendment >0 splits on AMD vs RPL. */
  private void publishDdmDecision(
      WorkflowEmailEvent.FspSnapshot snap, String amendmentNumber, String amendmentCode) {
    if (amendmentNumber.isEmpty() || "0".equals(amendmentNumber)) {
      emailService.publish(new WorkflowEmailEvent.FspDecision(snap));
    } else if ("AMD".equalsIgnoreCase(amendmentCode)) {
      emailService.publish(new WorkflowEmailEvent.AmendmentDecision(snap));
    } else {
      emailService.publish(new WorkflowEmailEvent.ReplacementDecision(snap));
    }
  }

  private void publishExtensionDecision(WorkflowEmailEvent.FspSnapshot snap, WorkflowState state) {
    WorkflowState.ExtensionDecision ext = state == null ? null : state.extensionDecision();
    // ext.name() holds the IDIR / submitter, matching legacy
    // fsp302Bean.getP_user_id(); ext.submissionDate() matches getP_submission_date().
    String submittedBy = ext == null ? "" : nz(ext.name());
    String submissionDate = ext == null ? "" : nz(ext.submissionDate());
    emailService.publish(
        new WorkflowEmailEvent.ExtensionDecision(snap, submittedBy, submissionDate));
  }

  /**
   * Legacy guard from {@code Fsp700WorkflowAction.java:397}: when the
   * pre-save status already equals the item being applied (e.g. DDM
   * adjusts the decision date on an already-APP'd FSP), the action
   * isn't a real state change and no email goes out.
   */
  private static boolean statusUnchanged(String oldStatusCode, String item) {
    return oldStatusCode != null && item.equalsIgnoreCase(oldStatusCode);
  }

  private WorkflowEmailEvent.FspSnapshot toSnapshot(FspRequest fsp, String history) {
    return new WorkflowEmailEvent.FspSnapshot(
        nz(fsp.getFspId()),
        nz(fsp.getFspAmendmentNumber()),
        nz(fsp.getFspPlanName()),
        nz(fsp.getFspStatusDesc()),
        nz(fsp.getFspContactName()),
        nz(fsp.getFspPlanSubmissionDate()),
        nz(fsp.getFspEmailAddress()),
        joinOrgUnits(fsp.getDistricts()),
        joinLicensees(fsp.getAgreementHolders()),
        history);
  }

  private static String joinOrgUnits(List<FspRequest.District> districts) {
    if (districts == null) return "";
    return districts.stream()
        .map(FspRequest.District::getOrgUnitCode)
        .filter(s -> s != null && !s.isEmpty())
        .collect(Collectors.joining(", "));
  }

  private static String joinLicensees(List<FspRequest.AgreementHolder> holders) {
    if (holders == null) return "";
    return holders.stream()
        .map(FspRequest.AgreementHolder::getClientNumber)
        .filter(s -> s != null && !s.isEmpty())
        .collect(Collectors.joining(", "));
  }

  /**
   * Replicates {@code Fsp700WorkflowAction.getHistory(items)}: the
   * legacy template only embeds the most-recent history row, prefixed
   * with "  - " and newline-terminated.
   */
  private String firstHistoryLine(String fspId) {
    try {
      Fsp800HistoryDao.Result result = historyDao.mainline(
          ACTION_GET, "", fspId, "", null,
          "", "", "", "",
          RequestUtil.getCurrentClientNumber(),
          RequestUtil.getCurrentLegacyRoles(),
          "", "", "", "", "");
      var rows = result.rows();
      if (rows == null || rows.isEmpty()) return "";
      return "  - " + nz(rows.get(0).description()) + "\n";
    } catch (RuntimeException e) {
      log.warn("Failed to load FSP history for {} email: {}", fspId, e.getMessage());
      return "";
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }

  /**
   * When {@code get_ddm_only} returns no decision for the resolved amendment
   * (it goes silent once the version is retired), look the recorded decision
   * up straight from {@code fsp_status_history}. Returns the fallback
   * decision when found; otherwise the original (blank) decision is kept.
   */
  private WorkflowState.DdmDecision ddmDecisionFallback(
      String fspId, String amendmentNumber, WorkflowState.DdmDecision current) {
    if (nz(fspId).isEmpty() || nz(amendmentNumber).isEmpty()) {
      return current;
    }
    long fspIdLong;
    long amendmentLong;
    try {
      fspIdLong = Long.parseLong(fspId.trim());
      amendmentLong = Long.parseLong(amendmentNumber.trim());
    } catch (NumberFormatException e) {
      return current;
    }
    var recorded = workflowQueryDao.findRecordedDecision(fspIdLong, amendmentLong);
    if (recorded == null) {
      return current;
    }
    return new WorkflowState.DdmDecision(
        recorded.statusCode(),
        recorded.name(),
        recorded.submissionDate(),
        recorded.decisionDate(),
        recorded.effectiveDate(),
        recorded.comment());
  }

  /**
   * Read {@code amendment_approval_date} for the resolved amendment via a
   * direct query (FSP_700 doesn't return it). Returns null for the original
   * plan, a blank/unparseable amendment number, or when the column is empty.
   */
  private String resolveAmendmentApprovalDate(String fspId, String amendmentNumber) {
    if (nz(fspId).isEmpty() || nz(amendmentNumber).isEmpty()) {
      return null;
    }
    try {
      return workflowQueryDao.findAmendmentApprovalDate(
          Long.parseLong(fspId.trim()), Long.parseLong(amendmentNumber.trim()));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /**
   * Pacific time zone the proc-side date arithmetic was tuned against
   * (legacy WebLogic JVM TZ). Hard-coded here so an API server running
   * in UTC doesn't accidentally roll an OTBH save to the previous day
   * after 00:00 UTC.
   */
  private static final ZoneId BC_TZ = ZoneId.of("America/Vancouver");

  private static final DateTimeFormatter ISO_TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
  private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;

  /**
   * Append a wall-clock time to an OTBH date so the proc's
   * date-sequence guard treats successive same-day saves as
   * monotonic. The check at
   * {@code R__06412_FSP_COMMON_DB.sql:1759} compares the incoming
   * {@code entry_timestamp} (strict {@code <}, no TRUNC) against the
   * most-recent {@code fsp_status_history.entry_timestamp} for the
   * same FSP + amendment. The prior OHS row from SAVE_OTBH_OFFERED
   * was written via {@code COALESCE(p_sh_entry_date, SYSDATE)} —
   * which means in practice the stored timestamp carries a sub-day
   * time component. A bare {@code "YYYY-MM-DD"} from the SPA parses
   * as midnight and trips the guard.
   *
   * <p>Behavior mirrors legacy {@code Fsp700WorkflowAction}:
   * <ul>
   *   <li>blank input → blank output (lets other actions go through
   *       the same call site without padding).</li>
   *   <li>today's local date → append the current wall-clock time so
   *       the Heard save sorts strictly after the same-day Offered.</li>
   *   <li>any past date → append {@code "00:00:00"} (the row this
   *       date is being compared against was also stamped earlier
   *       than today, so midnight-of-past < anything-newer is fine).</li>
   * </ul>
   *
   * <p>The helper is invoked unconditionally — non-OTBH actions send
   * {@code null}/blank for {@code otbhDate} and take the blank branch.
   */
  private static String buildOtbhTimestamp(String otbhDate) {
    if (otbhDate == null || otbhDate.isBlank()) return "";
    String date = otbhDate.trim();
    // Defensive: if the SPA ever starts shipping an ISO timestamp,
    // pass it through unchanged rather than glue on a second time.
    if (date.length() > 10) return date;
    LocalDate today = LocalDate.now(BC_TZ);
    String todayStr = today.format(ISO_DATE);
    if (date.equals(todayStr)) {
      return date + " " + LocalTime.now(BC_TZ).format(ISO_TIME);
    }
    return date + " 00:00:00";
  }
}
