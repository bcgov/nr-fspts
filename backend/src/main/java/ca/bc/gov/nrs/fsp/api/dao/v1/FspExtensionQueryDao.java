package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Lightweight, read-only extension-state checks used by submit/lifecycle
 * guards. Distinct from {@link Fsp302ExtensionRequestDao} /
 * {@link Fsp303ExtensionSummaryDao} (which wrap the FSP_302/FSP_303 procs
 * with audit-user context) — these are direct table queries so a caller
 * can cheaply answer "is an extension request still open on this plan?".
 */
public interface FspExtensionQueryDao {

  /**
   * True when the FSP has at least one extension request in Submitted
   * ({@code SUB}) status — i.e. an open request awaiting a DDM decision.
   * Mirrors the FSP300 read's {@code fspExtensionStat = 'S'} flag and the
   * proc's {@code FSP.EXT_STAT.SUBMITTED} rule. While such a request is
   * open no new amendment / extension / replacement may be started.
   */
  boolean hasOpenExtension(long fspId);

  /**
   * Attachments linked to a single extension via {@code fsp_extension_xref}
   * (e.g. the extension request letter and the DDM decision letter EXDDMD).
   * Backs the Extension Summary dialog's per-extension "Attachments" list.
   * Distinct from the FSP-linked attachments returned by the FSP_400 procs,
   * which are joined through {@code fsp_attachment_xref} instead.
   */
  java.util.List<ExtensionAttachment> findExtensionAttachments(long extensionId);

  /** One attachment row linked to an extension. */
  record ExtensionAttachment(String attachmentId, String attachmentName, String typeCode) {}
}
