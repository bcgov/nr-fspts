package ca.bc.gov.nrs.fsp.api.notification;

import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Listens for {@link WorkflowEmailEvent}s and dispatches the matching
 * email <em>after</em> the surrounding DB transaction commits, on a
 * dedicated executor so SMTP latency doesn't bleed into the request
 * thread.
 *
 * <p>The dispatcher is a thin renderer: every event carries its own
 * {@link WorkflowEmailEvent.FspSnapshot} (captured in the workflow
 * service where the JWT still lives), its own subject, and the
 * template name. Routing per event type is just a switch over which
 * fields go into the substitution context.
 *
 * <p>Transport is plain SMTP via {@link JavaMailSender} pointed at
 * {@code apps.smtp.gov.bc.ca} — the internal BC Gov relay, reachable
 * from OpenShift without auth.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EmailEventDispatcher {

  private final JavaMailSender mailSender;
  private final EmailTemplateRenderer renderer;

  @Value("${fsp.mail.from:donotreply.fsp@gov.bc.ca}")
  private String fromAddress;

  /**
   * Master kill-switch for automatic outbound email. Off by default —
   * an environment must explicitly opt in (ConfigMap / env
   * {@code EMAIL_SEND_ENABLED=true}) for any email to actually leave the
   * app. When off the workflow event is still processed and logged, but
   * the SMTP send is skipped. Set on PROD only once the mail path is
   * signed off; every other environment stays silent by default.
   */
  @Value("${fsp.mail.send-enabled:false}")
  private boolean sendEnabled;

  /** Announce the kill-switch state in the pod log at boot. */
  @EventListener(ApplicationReadyEvent.class)
  public void logMailStateAtStartup() {
    if (sendEnabled) {
      log.info("Automatic email sending is ENABLED (fsp.mail.send-enabled=true)");
    } else {
      log.warn(
          "Automatic email sending is DISABLED (fsp.mail.send-enabled=false) "
              + "— workflow emails will be prepared and logged but NOT sent");
    }
  }

  /**
   * Fired AFTER_COMMIT — if the workflow save rolls back, no email
   * gets sent. Runs on the {@code emailExecutor} pool defined in
   * {@code NotificationConfig} so a slow SMTP send doesn't block the
   * Spring transaction-event machinery. {@code fallbackExecution=true}
   * makes the dispatch fire even when the publish happens outside an
   * active transaction (e.g. a manual @Service call from a test).
   */
  @Async("emailExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
  public void onWorkflowEmailEvent(WorkflowEmailEvent event) {
    try {
      dispatch(event);
    } catch (RuntimeException ex) {
      // Best-effort: a transient SMTP failure shouldn't propagate; the
      // user's workflow action has already committed. If we start
      // seeing real loss here, the next step would be persisting a
      // small outbox and retrying.
      log.error("Failed to send workflow email for {}", event, ex);
    }
  }

  private void dispatch(WorkflowEmailEvent event) {
    var fsp = event.fsp();
    String to = fsp.emailAddress();
    if (to == null || to.isBlank()) {
      log.warn(
          "Skipping {} email for FSP {} amendment {} — no contact email on file",
          event.getClass().getSimpleName(),
          fsp.fspId(),
          fsp.amendmentNumber());
      return;
    }

    Map<String, String> ctx = baseContext(fsp);
    // Per-event additions / overrides. Most variants are pure
    // template-name swaps over the same shared snapshot, so the
    // switch stays narrow.
    if (event instanceof WorkflowEmailEvent.ExtensionDecision ext) {
      ctx.put("extensionSubmittedBy", nullToEmpty(ext.extensionSubmittedBy()));
      ctx.put("extensionSubmissionDate", nullToEmpty(ext.extensionSubmissionDate()));
    }

    String body = renderer.render(event.templateName(), ctx);

    if (!sendEnabled) {
      log.info(
          "Email sending disabled — would have sent {} email to {} for FSP {}/{}",
          event.getClass().getSimpleName(),
          to,
          fsp.fspId(),
          fsp.amendmentNumber());
      return;
    }

    SimpleMailMessage msg = new SimpleMailMessage();
    msg.setFrom(fromAddress);
    msg.setTo(to);
    msg.setSubject(event.subject());
    msg.setText(body);
    mailSender.send(msg);
    log.info(
        "Sent {} email to {} for FSP {}/{}",
        event.getClass().getSimpleName(),
        to,
        fsp.fspId(),
        fsp.amendmentNumber());
  }

  /**
   * Variables every template can reference. Mirrors what the legacy
   * action filled into {@code MessageFormat.format(...)} — kept as a
   * single map so a template gains a placeholder for free as long as
   * the snapshot already carries the field.
   */
  private static Map<String, String> baseContext(WorkflowEmailEvent.FspSnapshot fsp) {
    Map<String, String> ctx = new HashMap<>();
    ctx.put("fspId", nullToEmpty(fsp.fspId()));
    ctx.put("amendmentNumber", nullToEmpty(fsp.amendmentNumber()));
    ctx.put("planName", nullToEmpty(fsp.planName()));
    ctx.put("statusDesc", nullToEmpty(fsp.statusDesc()));
    ctx.put("contactName", nullToEmpty(fsp.contactName()));
    ctx.put("submissionDate", nullToEmpty(fsp.submissionDate()));
    ctx.put("emailAddress", nullToEmpty(fsp.emailAddress()));
    ctx.put("orgUnits", nullToEmpty(fsp.orgUnits()));
    ctx.put("licensees", nullToEmpty(fsp.licensees()));
    ctx.put("history", nullToEmpty(fsp.history()));
    return ctx;
  }

  private static String nullToEmpty(String s) {
    return s == null ? "" : s;
  }
}
