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
}
