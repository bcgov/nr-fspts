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
 *   <tr><td>REVIEWER</td><td>no</td><td>no</td><td>no</td></tr>
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
   * Roles permitted to take ministry workflow actions (DDM decision, OTBH,
   * review milestones, extension decisions). Submitters and read-only roles
   * are excluded. Status scoping (Decision Makers act only during the review
   * phase) is enforced in {@code WorkflowService}.
   */
  public static final String WORKFLOW_DECISION =
      "hasAnyRole('FSPTS_ADMINISTRATOR','FSPTS_DECISION_MAKER')";

  /** Administrator-only operations (district-notification designates). */
  public static final String ADMINISTRATOR =
      "hasRole('FSPTS_ADMINISTRATOR')";
}
