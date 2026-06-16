package ca.bc.gov.nrs.fsp.api.notification;

/**
 * Sealed marker for the workflow-side events that trigger an outbound
 * email. Each event carries an {@link FspSnapshot} captured in
 * {@code WorkflowService} while the JWT security context is still
 * alive — the dispatcher runs on a separate thread via
 * {@code @Async("emailExecutor")} where the JWT isn't present, so
 * lazily fetching FSP details from there would 401.
 *
 * <p>Per-event records add only the fields the legacy ladder needs to
 * differentiate decision wording.
 */
public sealed interface WorkflowEmailEvent {

  FspSnapshot fsp();

  /** Subject line for the email — picked here so the dispatcher stays a thin renderer. */
  String subject();

  /** Classpath template (without extension) the dispatcher should render. */
  String templateName();

  /**
   * Read-only snapshot of the data every email template can pull from.
   * Captured inside the workflow transaction so the JWT is still on
   * the thread; passed to the dispatcher verbatim.
   *
   * <p>{@code statusDesc} is the human-readable form of the FSP's
   * post-save status ("Approved", "Rejected", "Clarification Requested",
   * etc.) — already what {@code FSP_300_INFORMATION.GET} returns.
   */
  record FspSnapshot(
      String fspId,
      String amendmentNumber,
      String planName,
      String statusDesc,
      String contactName,
      String submissionDate,
      String emailAddress,
      String orgUnits,
      String licensees,
      String history) {}

  /** SAVE_DDM_APP / SAVE_DDM_REJ on the original plan (amendment 0). */
  record FspDecision(FspSnapshot fsp) implements WorkflowEmailEvent {
    @Override public String subject() { return "FSP Decision"; }
    @Override public String templateName() { return "fsp_decision_email"; }
  }

  /** SAVE_DDM_APP / SAVE_DDM_REJ on amendment > 0 with amendmentCode = AMD. */
  record AmendmentDecision(FspSnapshot fsp) implements WorkflowEmailEvent {
    @Override public String subject() { return "FSP Amendment Decision"; }
    @Override public String templateName() { return "amendment_decision_email"; }
  }

  /** SAVE_DDM_APP / SAVE_DDM_REJ on amendment > 0 with amendmentCode = RPL. */
  record ReplacementDecision(FspSnapshot fsp) implements WorkflowEmailEvent {
    // Legacy uses the same subject for replacement as amendment — preserved here.
    @Override public String subject() { return "FSP Amendment Decision"; }
    @Override public String templateName() { return "replacement_decision_email"; }
  }

  /** SAVE_EXT_APP / SAVE_EXT_REJ. */
  record ExtensionDecision(
      FspSnapshot fsp,
      String extensionSubmittedBy,
      String extensionSubmissionDate)
      implements WorkflowEmailEvent {
    @Override public String subject() { return "Extension Decision"; }
    @Override public String templateName() { return "extension_decision_email"; }
  }

  /** SAVE_OTBH_HEARD with completed=Y (OHS → SUB transition). */
  record OtbhHeard(FspSnapshot fsp) implements WorkflowEmailEvent {
    @Override public String subject() { return "FSP Opportunity To Be Heard"; }
    @Override public String templateName() { return "opportunity_to_be_heard_email"; }
  }

  /** SAVE_DDM_DFT with completed=Y. */
  record RequestClarification(FspSnapshot fsp) implements WorkflowEmailEvent {
    @Override public String subject() { return "FSP Clarification Request"; }
    @Override public String templateName() { return "request_clarification_email"; }
  }
}
