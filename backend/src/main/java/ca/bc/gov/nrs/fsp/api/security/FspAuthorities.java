package ca.bc.gov.nrs.fsp.api.security;

/**
 * Centralised method-security expressions for {@code @PreAuthorize}.
 *
 * <p>The role&rarr;capability matrix is defined once here so every endpoint
 * references a named capability rather than an inline role list, and so the
 * matrix can be tightened per role as access is finalised (see
 * {@link FsptsRoles}).
 *
 * <p>Authorities are exposed as {@code ROLE_FSPTS_*} (canonical + any
 * org-suffixed variant) by {@link CognitoGroupsAuthoritiesConverter}, so the
 * {@code hasRole}/{@code hasAnyRole} expressions below use the bare
 * {@code FSPTS_*} names and match every organization-suffixed group.
 *
 * <h2>Capability matrix</h2>
 * <table>
 *   <tr><th>Role</th><th>Content edit</th><th>Workflow decision</th><th>Administrator</th></tr>
 *   <tr><td>ADMINISTRATOR</td><td>yes</td><td>yes</td><td>yes</td></tr>
 *   <tr><td>DECISION_MAKER</td><td>no</td><td>yes (review phase)</td><td>no</td></tr>
 *   <tr><td>SUBMITTER</td><td>yes (own FSPs)</td><td>no</td><td>no</td></tr>
 *   <tr><td>REVIEWER</td><td>no</td><td>review milestones only (Submitted)</td><td>no</td></tr>
 *   <tr><td>VIEW_ALL</td><td>no</td><td>no</td><td>no</td></tr>
 *   <tr><td>VIEW_ONLY</td><td>no</td><td>no</td><td>no</td></tr>
 * </table>
 *
 * <p>These are coarse role-level gates. Per-FSP ownership (can <em>this</em>
 * submitter touch <em>that</em> FSP) is enforced separately by the proc
 * tombstone fence; this layer only decides whether a role may perform a
 * write at all. Read (GET) endpoints stay open to any authenticated FSPTS
 * role and are intentionally not gated here.
 */
public final class FspAuthorities {

  private FspAuthorities() {}

  /**
   * Roles permitted to create or modify FSP content: plan information,
   * stocking standards, attachments, FDU licences, extension requests, and
   * the XML / GeoJSON submission flow. Only Administrators and Submitters
   * edit content. Decision Makers (workflow-only) and the read-only roles
   * (Reviewer, View-All, View-Only) are excluded.
   */
  public static final String CONTENT_EDIT =
      "hasAnyRole('FSPTS_ADMINISTRATOR','FSPTS_SUBMITTER')";

  /**
   * Roles permitted to edit/upload ATTACHMENTS (matrix B2 — more permissive
   * than {@link #CONTENT_EDIT} because the ministry attaches review documents
   * while a plan is under decision). Admin / Submitter / Decision Maker /
   * Reviewer may reach the endpoint; the per-status rule (e.g. DM only on
   * SUB/OHS, Reviewer only on SUB, Submitter only on Draft) is enforced in
   * {@code FspAccessGuard.assertAttachmentEditable}. View-All / View-Only
   * excluded.
   */
  public static final String ATTACHMENT_EDIT =
      "hasAnyRole('FSPTS_ADMINISTRATOR','FSPTS_SUBMITTER',"
          + "'FSPTS_DECISION_MAKER','FSPTS_REVIEWER')";

  /**
   * Roles permitted to reach the ministry workflow endpoint (DDM decision,
   * OTBH, review milestones, extension decisions). Submitter / View-All /
   * View-Only are excluded here. The fine-grained per-action / per-status
   * matrix (FSPTS Permission Matrix section D) is enforced in
   * {@code WorkflowService.assertWorkflowActionAllowed}:
   * <ul>
   *   <li>Approve / Reject / review-milestone / Offer-OTBH / Record-OTBH —
   *       Decision Maker + Reviewer (<b>Administrator excluded</b>).</li>
   *   <li>Request clarification (SAVE_DDM_DFT) — Admin + DM + Reviewer.</li>
   *   <li>Extension decision (SAVE_EXT_*) — Admin + DM.</li>
   * </ul>
   * Administrator is admitted at this coarse gate because it still owns
   * request-clarification, extension, and the reverse/revert corrections.
   */
  public static final String WORKFLOW_DECISION =
      "hasAnyRole('FSPTS_ADMINISTRATOR','FSPTS_DECISION_MAKER','FSPTS_REVIEWER')";

  /** Administrator-only operations (district-notification designates). */
  public static final String ADMINISTRATOR =
      "hasRole('FSPTS_ADMINISTRATOR')";
}
