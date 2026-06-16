package ca.bc.gov.nrs.fsp.api.notification;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp901NotificationBatchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp901NotificationBatchDao.NotificationRow;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

/**
 * Drains the {@code FSP_901_NOTIFICATION_BATCH} queue and sends one
 * digest email per designate via SMTP. Mirrors the legacy
 * {@code BatchEmail.execute()} flow:
 *
 * <ol>
 *   <li>Pull every pending row via {@link Fsp901NotificationBatchDao#get()}.</li>
 *   <li>Group rows by {@code designateIdir} (each designate gets one
 *       email containing all their pending blocks).</li>
 *   <li>For each row, render the matching block template
 *       (extension-vs-FSP split keyed on {@code extensionId} being
 *       blank, matching the legacy {@code
 *       Fsp900BatchNotificationEmail.getMessageTemplate(extensionId)}
 *       split).</li>
 *   <li>Resolve each designate's email via {@link DesignateEmailResolver}.
 *       Designates that don't resolve get a WARN and are skipped —
 *       their queue rows stay pending so the next run can retry.</li>
 *   <li>Compose the envelope + concatenated blocks, send via
 *       {@link JavaMailSender}, then call
 *       {@link Fsp901NotificationBatchDao#change} for each emitted
 *       row so the next GET skips them.</li>
 * </ol>
 *
 * <p>CHANGE writes happen after the SMTP send returns success. If the
 * JVM crashes between send and CHANGE, the next run re-emits the same
 * blocks — preferred over the inverse (CHANGE first → drop on send
 * failure) and matches the legacy behaviour.
 *
 * <p>Conditional on {@code fsp.notification.designate.enabled=true}
 * so dev / CI startups don't carry the service bean (it would still
 * need its DAOs and resolver wired even when the scheduler is off).
 */
@Service
@ConditionalOnProperty(
    prefix = "fsp.notification.designate",
    name = "enabled",
    havingValue = "true")
@Slf4j
public class DesignateBatchService {

  private static final String ENVELOPE_TEMPLATE = "designate_envelope_email";
  private static final String DESIGNATE_BLOCK_TEMPLATE = "designate_block_email";
  private static final String EXTENSION_BLOCK_TEMPLATE = "extension_submission_block_email";
  private static final String SUBJECT = "FSP- Designate Notification";

  private final Fsp901NotificationBatchDao batchDao;
  private final EmailTemplateRenderer renderer;
  private final JavaMailSender mailSender;
  private final DesignateEmailResolver emailResolver;
  private final String fromAddress;

  public DesignateBatchService(
      Fsp901NotificationBatchDao batchDao,
      EmailTemplateRenderer renderer,
      JavaMailSender mailSender,
      DesignateEmailResolver emailResolver,
      @Value("${fsp.mail.from:donotreply.fsp@gov.bc.ca}") String fromAddress) {
    this.batchDao = batchDao;
    this.renderer = renderer;
    this.mailSender = mailSender;
    this.emailResolver = emailResolver;
    this.fromAddress = fromAddress;
  }

  /**
   * Entry point — called by {@link DesignateBatchScheduler} on the cron,
   * and exposed as a public method so an admin tool / health probe can
   * trigger an out-of-cycle drain. Idempotent: running it twice with
   * an empty queue is a no-op.
   *
   * @return a summary record describing what happened — useful for
   *     scheduler logs and future admin endpoints.
   */
  public BatchResult runOnce() {
    Fsp901NotificationBatchDao.GetResult result = batchDao.get();
    if (result.errorMessage() != null && !result.errorMessage().isBlank()) {
      log.error(
          "FSP_901_NOTIFICATION_BATCH.GET returned error — aborting batch: {}",
          result.errorMessage());
      return new BatchResult(0, 0, 0, 0, 0);
    }
    List<NotificationRow> pending = result.rows();
    if (pending == null || pending.isEmpty()) {
      log.info("Designate batch: queue empty, nothing to do");
      return new BatchResult(0, 0, 0, 0, 0);
    }

    Map<String, List<NotificationRow>> byDesignate = groupByDesignate(pending);
    int sent = 0;
    int sendFailed = 0;
    int skippedNoEmail = 0;
    int rowsDispatched = 0;
    for (var entry : byDesignate.entrySet()) {
      String idir = entry.getKey();
      List<NotificationRow> rowsForDesignate = entry.getValue();
      Optional<String> email = emailResolver.resolveEmail(idir);
      if (email.isEmpty() || email.get().isBlank()) {
        log.warn(
            "Designate batch: skipping {} pending row(s) for {} — no email resolved",
            rowsForDesignate.size(), idir);
        skippedNoEmail += rowsForDesignate.size();
        continue;
      }
      String body = renderEnvelopeBody(idir, rowsForDesignate);
      try {
        sendOne(email.get(), body);
      } catch (RuntimeException ex) {
        // Leave the queue intact for this designate so the next run retries.
        log.warn(
            "Designate batch: SMTP send failed for {} ({} rows); will retry next run",
            idir, rowsForDesignate.size(), ex);
        sendFailed++;
        continue;
      }
      markSent(rowsForDesignate);
      sent++;
      rowsDispatched += rowsForDesignate.size();
    }
    BatchResult summary = new BatchResult(
        pending.size(), rowsDispatched, sent, sendFailed, skippedNoEmail);
    log.info(
        "Designate batch finished — pending={} rowsDispatched={} sent={} sendFailed={} skippedNoEmail={}",
        summary.pendingTotal(),
        summary.rowsDispatched(),
        summary.sentCount(),
        summary.sendFailed(),
        summary.skippedNoEmail());
    return summary;
  }

  // ── internals ─────────────────────────────────────────────────────

  /** LinkedHashMap so designate order is deterministic for tests / logs. */
  private static Map<String, List<NotificationRow>> groupByDesignate(List<NotificationRow> rows) {
    Map<String, List<NotificationRow>> map = new LinkedHashMap<>();
    for (NotificationRow row : rows) {
      String idir = row.designateIdir();
      if (idir == null || idir.isBlank()) continue;
      map.computeIfAbsent(idir, k -> new ArrayList<>()).add(row);
    }
    return map;
  }

  /**
   * Builds the full per-designate body: envelope template with the
   * concatenated block renders spliced into {@code {{messages}}}.
   * Legacy joined blocks with {@code "\n\n"} — preserved here so the
   * divider line in each block template doesn't collide with the next.
   */
  private String renderEnvelopeBody(String idir, List<NotificationRow> rows) {
    StringBuilder messages = new StringBuilder();
    for (NotificationRow row : rows) {
      String template = isExtensionRow(row) ? EXTENSION_BLOCK_TEMPLATE : DESIGNATE_BLOCK_TEMPLATE;
      messages.append(renderer.render(template, blockContext(row))).append("\n\n");
    }
    return renderer.render(ENVELOPE_TEMPLATE, Map.of(
        "designateIdir", idir,
        "messages", messages.toString().stripTrailing()));
  }

  private static boolean isExtensionRow(NotificationRow row) {
    return row.extensionId() != null && !row.extensionId().isBlank();
  }

  private static Map<String, String> blockContext(NotificationRow r) {
    Map<String, String> ctx = new HashMap<>();
    ctx.put("fspId", nz(r.fspId()));
    ctx.put("amendmentNumber", nz(r.fspAmendmentNumber()));
    ctx.put("statusCode", nz(r.statusCode()));
    ctx.put("entryUserid", nz(r.entryUserid()));
    ctx.put("entryTimestamp", nz(r.entryTimestamp()));
    ctx.put("fduUpdateInd", nz(r.fduUpdateInd()));
    ctx.put("identifiedAreasUpdateInd", nz(r.identifiedAreasUpdateInd()));
    ctx.put("stockingStandardUpdateInd", nz(r.stockingStandardUpdateInd()));
    ctx.put("fduAttachments", nz(r.fduAttachments()));
    ctx.put("iaAttachments", nz(r.iaAttachments()));
    ctx.put("fduSpatialChanged", nz(r.fduSpatialChanged()));
    ctx.put("identifiedSpatialChanged", nz(r.identifiedSpatialChanged()));
    ctx.put("stockingStandardsChanged", nz(r.stockingStandardsChanged()));
    // Legacy mapped Y → "requiring approval", anything else → "not requiring approval".
    ctx.put(
        "approvalRequirement",
        "Y".equalsIgnoreCase(nz(r.amendmentApprovalRequirdInd()))
            ? "requiring approval"
            : "not requiring approval");
    return ctx;
  }

  private void sendOne(String to, String body) {
    SimpleMailMessage msg = new SimpleMailMessage();
    msg.setFrom(fromAddress);
    msg.setTo(to);
    msg.setSubject(SUBJECT);
    msg.setText(body);
    mailSender.send(msg);
  }

  /**
   * One CHANGE per emitted row to match the legacy semantic of
   * "advance the high-watermark per (fsp, amendment)". Failures here
   * are logged but don't unwind the send — a duplicate email on the
   * next run is preferable to a lost CHANGE.
   */
  private void markSent(List<NotificationRow> rows) {
    for (NotificationRow row : rows) {
      try {
        batchDao.change(row.fspId(), row.fspAmendmentNumber(), row.maxStatusId());
      } catch (RuntimeException ex) {
        log.warn(
            "FSP_901_NOTIFICATION_BATCH.CHANGE failed for fsp {}/{} maxStatusId={}; "
                + "row may resend next batch",
            row.fspId(), row.fspAmendmentNumber(), row.maxStatusId(), ex);
      }
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }

  /**
   * @param pendingTotal rows returned by GET this run.
   * @param rowsDispatched rows whose blocks were included in a sent email.
   * @param sentCount number of per-designate emails accepted by SMTP.
   * @param sendFailed designates whose SMTP send threw — their rows stay pending.
   * @param skippedNoEmail rows not dispatched because the resolver
   *     returned empty for their designate.
   */
  public record BatchResult(
      int pendingTotal,
      int rowsDispatched,
      int sentCount,
      int sendFailed,
      int skippedNoEmail) {}
}
