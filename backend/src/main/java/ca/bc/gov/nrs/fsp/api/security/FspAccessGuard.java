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
  // A linked stocking standard is Approved — approved standards are read-only
  // regardless of the parent FSP's own edit state.
  private static final String STANDARDS_NOT_EDITABLE = "fsp.web.error.standards_not_editable";
  private static final String STANDARDS_STATUS_APPROVED = "APP";

  // --- Extension supporting-document carve-out (see assertAttachmentEditable) ---
  /**
   * FSP_ATTACHMENT_TYPE_CODE {@code EXT} — "Extension Request". Added to
   * the code table on 2011-02-03, the same day as {@code EXDDMD}
   * ("Extension DDM Decision"): the pair exists specifically for this
   * feature, which is why the carve-out keys on it. Deliberately NOT
   * {@code OTHR} ("Other Attachment") — that is a catch-all, and carving
   * it out would let a Submitter attach any miscellaneous document to an
   * Approved / In-Effect plan.
   */
  private static final String TYPE_EXTENSION_REQUEST = "EXT";
  /**
   * FSP_ATTACHMENT_TYPE_CODE {@code EXDDMD} — "Extension DDM Decision",
   * {@code EXT}'s sibling (both added 2011-02-03). Carved out for the
   * Decision Maker only; a Submitter must never be able to file the
   * document that decides their own extension.
   */
  private static final String TYPE_EXTENSION_DECISION = "EXDDMD";
  private static final String FSP_STATUS_APPROVED = "APP";
  private static final String FSP_STATUS_IN_EFFECT = "INE";
  /** An extension awaiting a DDM decision — FSP_TYPES.FSP_STAT_SUB. */
  private static final String EXTENSION_STATUS_SUBMITTED = "SUB";
  // Same signal FspExtensionQueryDao.hasOpenExtension uses. Queried here
  // directly rather than injecting that DAO, to keep the guard's
  // dependencies to the JdbcTemplate it already holds.
  private static final String OPEN_EXTENSION_COUNT_SQL =
      "SELECT COUNT(1) FROM the.fsp_extension WHERE fsp_id = ? AND fsp_status_code = ?";

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
    assertAttachmentEditable(fspId, amendmentNumber, null);
  }

  /**
   * As {@link #assertAttachmentEditable(String, String)}, plus the
   * <b>extension supporting-document carve-out</b>.
   *
   * <p>Requesting an extension is explicitly valid for a Submitter on an
   * Approved / In-Effect plan — {@link #assertContentEditable} documents
   * that exemption and {@code ExtensionService.createRequest} deliberately
   * runs without a status guard. But B2 was never given the matching
   * exemption, so the supporting letter the extension dialog uploads was
   * refused with {@code not_editable_status} <em>after</em> the request had
   * already been created. The request succeeded, the attachment was
   * silently dropped, and the Submitter could not retry from anywhere.
   *
   * <p>The carve-out is deliberately narrow — all four must hold:
   * <ul>
   *   <li>the caller owns the FSP ({@link #assertWritable}, run first);</li>
   *   <li>the attachment type is {@code OTHR} (Supporting Documents) —
   *       never a legal document, amendment description, or decision
   *       letter;</li>
   *   <li>the plan is Approved or In-Effect — the only statuses an
   *       extension can be requested on;</li>
   *   <li>the FSP actually has an extension in {@code SUB} (awaiting a
   *       decision), so the window is open only while a request is
   *       genuinely pending.</li>
   * </ul>
   *
   * <p>Deletion is intentionally NOT carved out: it still routes through
   * the two-arg overload, so a Submitter cannot remove attachments from an
   * Approved / In-Effect plan.
   *
   * @param attachmentTypeCode FSP_ATTACHMENT_TYPE_CODE of the upload, or
   *                           null for callers with no type context (which
   *                           get the unmodified B2 rule).
   */
  public void assertAttachmentEditable(
      String fspId, String amendmentNumber, String attachmentTypeCode) {
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
      // + the EXT supporting letter, while their extension request is open.
      editable = "DFT".equals(status)
          || (TYPE_EXTENSION_REQUEST.equals(attachmentTypeCode)
              && isDuringOpenExtension(fspIdLong, status));
    } else if (FsptsRoles.DECISION_MAKER.equals(role)) {
      // + the EXDDMD decision letter, while an extension awaits their
      // decision. Without this a pure Decision Maker cannot approve or
      // reject an extension at all: the plan is Approved / In-Effect (not
      // SUB/OHS) for the whole request, so the upload is refused — and
      // FSP_700_WORKFLOW.validate_ext_approve_reject raises
      // FSP.CANNOT.APPROVE_OR_REJECT.NO_DMD_LETTER without that letter.
      editable = "SUB".equals(status) || "OHS".equals(status)
          || (TYPE_EXTENSION_DECISION.equals(attachmentTypeCode)
              && isDuringOpenExtension(fspIdLong, status));
    } else if (FsptsRoles.REVIEWER.equals(role)) {
      editable = "SUB".equals(status);
    } else {
      editable = false;
    }

    if (!editable) {
      log.info("Attachment edit to FSP {} amd {} denied: role={} status={} type={}",
          fspIdLong, amendment, role, status, attachmentTypeCode);
      throw denyStatus(fspId, status, role);
    }
  }

  /**
   * Assert a stocking standard (standards regime) is NOT approved. An approved
   * standard linked to an FSP is read-only — the user must Copy it (which
   * yields an editable draft) to change it — independent of the parent FSP's
   * own edit state. Call this IN ADDITION to {@link #assertContentEditable} on
   * every standards content-edit path (overview / layers / species / BGC /
   * attachments). Structural operations (create, copy, associate, delete,
   * unlink) are exempt.
   *
   * <p>Throws a 403-mapped {@link StoredProcedureException} when the regime is
   * Approved. Fails <b>open</b> (allows the edit) when the status can't be read
   * — a missing/unreadable regime is left to the write proc to reject, and we
   * don't want a transient lookup blip to block legitimate draft edits.
   */
  public void assertStandardsRegimeEditable(String regimeId) {
    final long id;
    try {
      id = Long.parseLong(regimeId);
    } catch (NumberFormatException e) {
      return; // non-numeric → let the write proc handle it
    }
    String status;
    try {
      String s = jdbcTemplate.queryForObject(
          "SELECT standards_regime_status_code FROM standards_regime"
              + " WHERE standards_regime_id = ?",
          String.class, id);
      status = s == null ? "" : s.trim().toUpperCase();
    } catch (DataAccessException e) {
      // No row, or a lookup error — fail open (see javadoc).
      return;
    }
    if (STANDARDS_STATUS_APPROVED.equals(status)) {
      log.info("Content edit to standards regime {} denied: status={}", regimeId, status);
      throw new StoredProcedureException(
          "FspAccessGuard", "assertStandardsRegimeEditable",
          STANDARDS_NOT_EDITABLE + " (regime " + regimeId + ": status=" + status + ")");
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

  /**
   * True when an extension request is genuinely open on this FSP and the
   * plan is in one of the statuses an extension can be requested on.
   *
   * <p>This is the window both extension carve-outs hang off — the
   * Submitter's {@code EXT} supporting letter and the Decision Maker's
   * {@code EXDDMD} decision letter. Creating an extension never touches
   * {@code forest_stewardship_plan.fsp_status_code} (traced through
   * {@code FSP_302.save} → {@code fsp_common_db.fsp_create_extension} →
   * {@code fsp_extension_status_update}: they write only
   * {@code fsp_extension} and {@code fsp_status_history}), so the plan
   * sits at Approved / In-Effect for the whole life of the request while
   * only the extension row carries {@code SUB}. Neither role's normal B2
   * window overlaps that, which is why both need the exemption.
   *
   * <p>Fails <b>closed</b>: if the extension lookup errors, no carve-out
   * applies and the normal B2 rule stands.
   */
  private boolean isDuringOpenExtension(long fspId, String status) {
    if (!FSP_STATUS_APPROVED.equals(status) && !FSP_STATUS_IN_EFFECT.equals(status)) {
      return false;
    }
    try {
      Integer open = jdbcTemplate.queryForObject(
          OPEN_EXTENSION_COUNT_SQL, Integer.class, fspId, EXTENSION_STATUS_SUBMITTED);
      return open != null && open > 0;
    } catch (DataAccessException e) {
      log.warn("Open-extension lookup failed for FSP {}; denying carve-out", fspId, e);
      return false;
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
