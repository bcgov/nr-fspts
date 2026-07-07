package ca.bc.gov.nrs.fsp.api.security;

import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Per-FSP ownership fence for write operations.
 *
 * <p>Most write procs already thread the caller's client number + role
 * and fence internally via {@code fsp_tombstone.user_may_access}, but the
 * coverage was inconsistent (e.g. the attachment and standards-regime
 * write paths bypassed it). This guard makes the fence explicit and
 * uniform: call {@link #assertWritable} at the top of every FSP-write
 * service method.
 *
 * <p>The check delegates to the same {@code user_may_access} function the
 * tombstone reads use, so the rules stay in one place:
 * <ul>
 *   <li>Administrator / Decision Maker / Reviewer — may access any FSP.</li>
 *   <li>View-All — approved / in-effect / retired FSPs.</li>
 *   <li><b>Submitter — only FSPs their org is an agreement holder on</b>
 *       (or, matching legacy, when no active-org client number is set).</li>
 *   <li>View-Only — agreement-holder + approved.</li>
 * </ul>
 *
 * <p>A denial surfaces as {@code fsp.web.error.no_access_right}, which
 * {@code ProcErrorMessages} maps to HTTP 403 — identical to a proc-raised
 * denial. The check fails closed: any error resolving access is a denial.
 */
@Component
@Slf4j
public class FspAccessGuard {

  private static final String NO_ACCESS = "fsp.web.error.no_access_right";
  // Ownership is fine but the FSP's status forbids a direct content edit —
  // a distinct key so the message accurately says "amend it" rather than the
  // misleading "you don't have access / wrong org".
  private static final String NOT_EDITABLE_STATUS = "fsp.web.error.not_editable_status";

  private final JdbcTemplate jdbcTemplate;

  public FspAccessGuard(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  /**
   * Assert the current user may modify the given FSP. When
   * {@code amendmentNumber} is blank the latest amendment is used (the
   * row a write targets). Throws a 403-mapped {@link StoredProcedureException}
   * when access is denied.
   */
  public void assertWritable(String fspId, String amendmentNumber) {
    final long fspIdLong;
    try {
      fspIdLong = Long.parseLong(fspId);
    } catch (NumberFormatException e) {
      throw deny(fspId, "non-numeric fsp id");
    }

    Long amendment = parseAmendment(amendmentNumber);
    if (amendment == null) {
      amendment = latestAmendment(fspIdLong);
    }

    String clientNumber = RequestUtil.getCurrentClientNumber();
    String roles = RequestUtil.getCurrentLegacyRoles();

    String mayAccess;
    try {
      mayAccess = jdbcTemplate.queryForObject(
          "SELECT the.fsp_tombstone.user_may_access(?, ?, ?, ?) FROM dual",
          String.class, fspIdLong, amendment, clientNumber, roles);
    } catch (DataAccessException e) {
      log.warn("user_may_access check failed for FSP {} amd {} (denying): {}",
          fspIdLong, amendment, e.getMessage());
      throw deny(fspId, "access check error");
    }

    if (!"Y".equalsIgnoreCase(mayAccess == null ? "" : mayAccess.trim())) {
      log.info("Write to FSP {} amd {} denied for client={} roles={}",
          fspIdLong, amendment, clientNumber, roles);
      throw deny(fspId, "user_may_access=N");
    }
  }

  /**
   * Assert the current user may EDIT FSP content (Information / Attachments /
   * Stocking Standards / FDU) in the FSP's current status — the status layer on
   * top of {@link #assertWritable}'s ownership fence:
   *
   * <ul>
   *   <li><b>Administrator</b> — editable in <em>every</em> status
   *       (FSPTS Permission Matrix B1, client-confirmed 2026-07-06).</li>
   *   <li><b>Submitter</b> — editable only while Draft (DFT).</li>
   *   <li>any other effective role — never (defense-in-depth; the endpoint is
   *       already gated by {@code FspAuthorities.CONTENT_EDIT}).</li>
   * </ul>
   *
   * <p>This governs <b>general content</b> (Information / Stocking Standards /
   * FDU). Attachments (matrix B2) are more permissive — Decision Maker /
   * Reviewer may edit them while a plan is under review — and must go through
   * {@link #assertAttachmentEditable} instead.</p>
   *
   * <p>Amend / Extend / Replace are a separate flow and must NOT call this —
   * they are valid for Administrator / Submitter on Approved / In-Effect plans
   * even though direct editing is locked there. Mirrors the frontend
   * {@code canEditFsp}. Throws a 403-mapped {@link StoredProcedureException} on
   * violation; fails closed if the status can't be read.
   */
  public void assertContentEditable(String fspId, String amendmentNumber) {
    // Ownership fence first (same as a plain write), then the status layer.
    assertWritable(fspId, amendmentNumber);

    final long fspIdLong;
    try {
      fspIdLong = Long.parseLong(fspId);
    } catch (NumberFormatException e) {
      throw deny(fspId, "non-numeric fsp id");
    }

    Long amendment = parseAmendment(amendmentNumber);
    if (amendment == null) {
      amendment = latestAmendment(fspIdLong);
    }

    String status = currentStatus(fspIdLong, amendment);
    if (status.isEmpty()) {
      throw deny(fspId, "status unavailable");
    }

    String role = RequestUtil.getEffectiveRole();
    boolean editable;
    if (FsptsRoles.ADMINISTRATOR.equals(role)) {
      editable = true; // matrix B1 — Administrator edits content in any status
    } else if (FsptsRoles.SUBMITTER.equals(role)) {
      editable = "DFT".equals(status);
    } else {
      editable = false;
    }

    if (!editable) {
      log.info("Content edit to FSP {} amd {} denied: role={} status={}",
          fspIdLong, amendment, role, status);
      throw denyStatus(fspId, status, role);
    }
  }

  /**
   * Assert the current user may EDIT/UPLOAD ATTACHMENTS in the FSP's current
   * status — matrix section B2, which is more permissive than general content
   * ({@link #assertContentEditable}) because the ministry attaches review
   * documents while a plan is under decision:
   *
   * <ul>
   *   <li><b>Administrator</b> — any status.</li>
   *   <li><b>Submitter</b> — Draft (DFT) only.</li>
   *   <li><b>Decision Maker</b> — Submitted (SUB) or Opportunity-to-be-Heard
   *       (OHS).</li>
   *   <li><b>Reviewer</b> — Submitted (SUB) only.</li>
   *   <li>any other effective role — never.</li>
   * </ul>
   *
   * <p>Runs the {@link #assertWritable} ownership fence first, then the
   * per-status role check. Throws a 403-mapped {@link StoredProcedureException}
   * on violation; fails closed if the status can't be read.
   */
  public void assertAttachmentEditable(String fspId, String amendmentNumber) {
    assertWritable(fspId, amendmentNumber);

    final long fspIdLong;
    try {
      fspIdLong = Long.parseLong(fspId);
    } catch (NumberFormatException e) {
      throw deny(fspId, "non-numeric fsp id");
    }

    Long amendment = parseAmendment(amendmentNumber);
    if (amendment == null) {
      amendment = latestAmendment(fspIdLong);
    }

    String status = currentStatus(fspIdLong, amendment);
    if (status.isEmpty()) {
      throw deny(fspId, "status unavailable");
    }

    String role = RequestUtil.getEffectiveRole();
    boolean editable;
    if (FsptsRoles.ADMINISTRATOR.equals(role)) {
      editable = true;
    } else if (FsptsRoles.SUBMITTER.equals(role)) {
      editable = "DFT".equals(status);
    } else if (FsptsRoles.DECISION_MAKER.equals(role)) {
      editable = "SUB".equals(status) || "OHS".equals(status);
    } else if (FsptsRoles.REVIEWER.equals(role)) {
      editable = "SUB".equals(status);
    } else {
      editable = false;
    }

    if (!editable) {
      log.info("Attachment edit to FSP {} amd {} denied: role={} status={}",
          fspIdLong, amendment, role, status);
      throw denyStatus(fspId, status, role);
    }
  }

  private String currentStatus(long fspId, Long amendment) {
    try {
      String s = jdbcTemplate.queryForObject(
          "SELECT fsp_status_code FROM the.forest_stewardship_plan"
              + " WHERE fsp_id = ? AND fsp_amendment_number = ?",
          String.class, fspId, amendment);
      return s == null ? "" : s.trim().toUpperCase();
    } catch (DataAccessException e) {
      log.warn("status lookup failed for FSP {} amd {} (denying edit): {}",
          fspId, amendment, e.getMessage());
      return ""; // fail closed
    }
  }

  private Long parseAmendment(String amendmentNumber) {
    if (amendmentNumber == null || amendmentNumber.isBlank()) return null;
    try {
      return Long.valueOf(amendmentNumber.trim());
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private Long latestAmendment(long fspId) {
    try {
      Long max = jdbcTemplate.queryForObject(
          "SELECT MAX(fsp_amendment_number) FROM the.forest_stewardship_plan WHERE fsp_id = ?",
          Long.class, fspId);
      // No rows → treat as amendment 0; user_may_access will deny on a
      // non-existent FSP anyway (NO_DATA_FOUND → 'N').
      return max == null ? 0L : max;
    } catch (DataAccessException e) {
      log.warn("latest-amendment lookup failed for FSP {} (using 0): {}", fspId, e.getMessage());
      return 0L;
    }
  }

  private StoredProcedureException deny(String fspId, String reason) {
    return new StoredProcedureException(
        "FSP_TOMBSTONE", "user_may_access",
        NO_ACCESS + " (FSP " + fspId + ": " + reason + ")");
  }

  /**
   * Denial for the status layer — the caller owns the FSP but its status
   * doesn't allow a direct content edit. Carries {@link #NOT_EDITABLE_STATUS}
   * so {@code RestExceptionHandler} surfaces the "amend it" message instead of
   * the no-access / wrong-org one.
   */
  private StoredProcedureException denyStatus(String fspId, String status, String role) {
    return new StoredProcedureException(
        "FspAccessGuard", "assertContentEditable",
        NOT_EDITABLE_STATUS + " (FSP " + fspId + ": status=" + status + " role=" + role + ")");
  }
}
