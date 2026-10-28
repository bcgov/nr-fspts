package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp901NotificationBatchDao;
import ca.bc.gov.nrs.fsp.api.exception.ConflictFoundException;
import ca.bc.gov.nrs.fsp.api.exception.ProcErrorMessages;
import ca.bc.gov.nrs.fsp.api.notification.EmailNotificationService;
import ca.bc.gov.nrs.fsp.api.notification.WorkflowEmailEvent;
import ca.bc.gov.nrs.fsp.api.struct.v1.AmendmentRevertResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import java.sql.Timestamp;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Administrator "revert approval" on the current amendment. The amendment's
 * status decides where it goes — the same targets as the legacy
 * {@code FSP_700_WORKFLOW} undo branch ({@code SAVE_DDM_APP} with
 * completed='N'):
 *
 * <ul>
 *   <li><b>APP</b> (formal DDM approval) → <b>SUB</b>. A Decision Maker
 *       then decides again.</li>
 *   <li><b>INE</b> (in effect without approval) → <b>DFT</b>. The
 *       submitter can edit, resubmit or delete it.</li>
 * </ul>
 *
 * <p>Only an AMD amendment (never the original or a replacement) that is the
 * plan's newest live amendment, with no approved/submitted extension attached
 * to it, can be reverted.
 *
 * <p>All in one transaction:
 * <ol>
 *   <li>{@code fsp_common_db.fsp_status_update} changes the status and writes
 *       the FSP_STATUS_HISTORY row (carrying the admin's reason). Nothing
 *       earlier in history is touched.</li>
 *   <li>That proc also re-stamps every linked non-default standard with the
 *       new FSP status; those are put back to their pre-revert status so
 *       approved standards stay Approved.</li>
 *   <li>Approval fields are cleared. Going to SUB keeps the original
 *       submission date (the proc re-stamps it with today); going to DFT
 *       clears it too.</li>
 *   <li>A move to SUB writes a history row the designate digest
 *       ({@code FSP_901_NOTIFICATION_BATCH}) would report as a new
 *       submission, so it's marked as already sent.</li>
 * </ol>
 * Emails (reversal notice to the FSP contact, SSID list to the standards
 * inbox) go out after commit.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AmendmentRevertService {

  static final int MAX_REASON_LENGTH = 2000;

  private final AmendmentRevertDao revertDao;
  private final Fsp901NotificationBatchDao notificationBatchDao;
  private final FspService fspService;
  private final EmailNotificationService emailService;

  @Value("${fsp.mail.revert-standards-inbox:}")
  private String standardsInbox;

  @Transactional
  public AmendmentRevertResponse revert(String fspId, String amendmentNumber, String reason) {
    if (!RequestUtil.isCurrentUserAdmin()) {
      throw new AccessDeniedException("Only an Administrator can revert an amendment.");
    }
    String trimmedReason = reason == null ? "" : reason.trim();
    if (trimmedReason.isEmpty()) {
      throw new IllegalArgumentException("A reason for the revert is required.");
    }
    if (trimmedReason.length() > MAX_REASON_LENGTH) {
      throw new IllegalArgumentException(
          "The reason can be at most " + MAX_REASON_LENGTH + " characters.");
    }
    long fspIdLong = parseId(fspId, "FSP ID");
    long amendment = parseId(amendmentNumber, "amendment number");
    if (amendment <= 0) {
      throw new ConflictFoundException("The original FSP can't be reverted.");
    }

    AmendmentRevertDao.AmendmentRow row = revertDao.findAmendment(fspIdLong, amendment)
        .orElseThrow(() -> new IllegalArgumentException(
            "Amendment " + amendment + " doesn't exist on FSP " + fspId + "."));
    String previousStatus = nz(row.statusCode()).toUpperCase();
    String targetStatus = switch (previousStatus) {
      case "APP" -> "SUB";
      case "INE" -> "DFT";
      default -> throw new ConflictFoundException(
          "Only an Approved or In Effect amendment can be reverted.");
    };
    if (!"AMD".equalsIgnoreCase(nz(row.amendmentCode()))) {
      throw new ConflictFoundException("A replacement can't be reverted.");
    }
    if (revertDao.countLaterLiveAmendments(fspIdLong, amendment) > 0) {
      throw new ConflictFoundException(
          "Only the most recent amendment can be reverted. FSP " + fspId
              + " has a later amendment than amendment " + amendment + ".");
    }
    if (revertDao.countExtensionsOnAmendment(fspIdLong, amendment) > 0) {
      throw new ConflictFoundException(
          "This amendment has an extension attached to it, so it can't be reverted.");
    }

    List<AmendmentRevertDao.LinkedStandard> standards =
        revertDao.findNonDefaultStandards(fspIdLong, amendment);
    String userId = RequestUtil.getCurrentAuditUserId();
    String comment = "Decision reversed by administrator. Reason: " + trimmedReason;

    List<AmendmentRevertDao.ProcError> errors =
        revertDao.updateStatus(fspIdLong, amendment, targetStatus, comment, userId);
    if (!errors.isEmpty()) {
      log.warn("Revert of FSP {} amendment {} refused by fsp_status_update: {}",
          fspId, amendment, errors);
      throw new ConflictFoundException(
          "The amendment couldn't be reverted: " + describe(errors));
    }
    String afterStatus = revertDao.findAmendment(fspIdLong, amendment)
        .map(r -> nz(r.statusCode()).toUpperCase())
        .orElse("");
    if (!targetStatus.equals(afterStatus)) {
      log.error("Revert of FSP {} amendment {}: expected status {} after fsp_status_update, got {}",
          fspId, amendment, targetStatus, afterStatus);
      throw new IllegalStateException("Amendment status didn't change as expected.");
    }

    // fsp_status_update set every linked non-default standard to the new
    // FSP status. Put each back so approved standards stay Approved (they
    // may already be referenced by RESULTS openings).
    for (AmendmentRevertDao.LinkedStandard s : standards) {
      revertDao.setStandardStatus(s.regimeId(), s.statusCode());
    }

    Timestamp keptSubmissionDate = "SUB".equals(targetStatus) ? row.amendmentSubmissionDate() : null;
    revertDao.clearApprovalFields(fspIdLong, amendment, keptSubmissionDate, userId);

    if ("SUB".equals(targetStatus)) {
      Long historyId = revertDao.findLatestHistoryId(fspIdLong, amendment, "SUB");
      if (historyId != null) {
        notificationBatchDao.change(fspId, String.valueOf(amendment), String.valueOf(historyId));
      }
    }

    log.info("FSP {} amendment {} reverted {} -> {} by {}; {} non-default standard(s) kept at "
            + "their prior status", fspId, amendment, previousStatus, targetStatus, userId,
        standards.size());

    List<AmendmentRevertDao.LinkedStandard> approved = standards.stream()
        .filter(s -> "APP".equalsIgnoreCase(s.statusCode()))
        .toList();
    publishEmails(fspId, String.valueOf(amendment), previousStatus, trimmedReason, approved);

    return new AmendmentRevertResponse(
        fspId, String.valueOf(amendment), previousStatus, targetStatus, approved.size());
  }

  /** Best-effort: a failure building the email must not undo the revert. */
  private void publishEmails(
      String fspId,
      String amendment,
      String previousStatus,
      String reason,
      List<AmendmentRevertDao.LinkedStandard> approvedStandards) {
    FspRequest fsp;
    try {
      fsp = fspService.getById(fspId, amendment);
    } catch (RuntimeException e) {
      log.warn("Skipping revert emails — failed to load FSP {}/{}: {}",
          fspId, amendment, e.getMessage());
      return;
    }
    if (fsp == null) {
      log.warn("Skipping revert emails — FSP {}/{} not found after revert", fspId, amendment);
      return;
    }
    WorkflowEmailEvent.FspSnapshot snap = toSnapshot(fsp);
    String previousDesc = statusDescription(previousStatus);
    emailService.publish(new WorkflowEmailEvent.AmendmentReverted(snap, previousDesc, reason));

    if (approvedStandards.isEmpty()) return;
    if (standardsInbox == null || standardsInbox.isBlank()) {
      log.warn("FSP {}/{} reverted with {} approved standard(s) but "
              + "fsp.mail.revert-standards-inbox is not set — standards notice not sent",
          fspId, amendment, approvedStandards.size());
      return;
    }
    String list = approvedStandards.stream()
        .map(s -> "  - SSID " + s.regimeId()
            + (s.name() == null || s.name().isBlank() ? "" : " - " + s.name()))
        .collect(Collectors.joining("\n"));
    emailService.publish(new WorkflowEmailEvent.RevertedStandardsNotice(
        snap, previousDesc, reason, list, standardsInbox.trim()));
  }

  private static WorkflowEmailEvent.FspSnapshot toSnapshot(FspRequest fsp) {
    String orgUnits = fsp.getDistricts() == null ? "" : fsp.getDistricts().stream()
        .map(FspRequest.District::getOrgUnitCode)
        .filter(s -> s != null && !s.isEmpty())
        .collect(Collectors.joining(", "));
    String licensees = fsp.getAgreementHolders() == null ? "" : fsp.getAgreementHolders().stream()
        .map(FspRequest.AgreementHolder::getClientNumber)
        .filter(s -> s != null && !s.isEmpty())
        .collect(Collectors.joining(", "));
    return new WorkflowEmailEvent.FspSnapshot(
        nz(fsp.getFspId()),
        nz(fsp.getFspAmendmentNumber()),
        nz(fsp.getFspPlanName()),
        nz(fsp.getFspStatusDesc()),
        nz(fsp.getFspContactName()),
        nz(fsp.getFspPlanSubmissionDate()),
        nz(fsp.getFspEmailAddress()),
        orgUnits,
        licensees,
        "");
  }

  private static String statusDescription(String code) {
    return "INE".equals(code) ? "In Effect" : "Approved";
  }

  private static String describe(List<AmendmentRevertDao.ProcError> errors) {
    return errors.stream()
        .map(e -> {
          String curated = ProcErrorMessages.messageFor(e.code());
          if (curated != null) return curated;
          return e.procMessage() != null && !e.procMessage().isBlank() ? e.procMessage() : e.code();
        })
        .distinct()
        .collect(Collectors.joining(" "));
  }

  private static long parseId(String value, String label) {
    try {
      return Long.parseLong(nz(value).trim());
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("Invalid " + label + ": " + value);
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
