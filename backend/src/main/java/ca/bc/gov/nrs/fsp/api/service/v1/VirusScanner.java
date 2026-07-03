package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.client.ClamAvClient;
import ca.bc.gov.nrs.fsp.api.client.ScanResult;
import ca.bc.gov.nrs.fsp.api.exception.VirusDetectedException;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Policy layer over {@link ClamAvClient}: decides what a raw
 * {@link ScanResult} means for an upload.
 *
 * <ul>
 *   <li>{@code fsp.clamav.enabled} (default {@code false}) — when off,
 *       every check is a no-op and uploads are unaffected. This is the
 *       local + test default, so nothing attempts a socket connection.</li>
 *   <li>{@code fsp.clamav.fail-open} (default {@code false} = fail-CLOSED)
 *       — when the scanner errors/times out, fail-closed rejects the
 *       upload; fail-open lets it through with a warning.</li>
 * </ul>
 */
@Component
public class VirusScanner {

  private static final Logger LOG = LoggerFactory.getLogger(VirusScanner.class);

  /** Code surfaced when a signature is detected. */
  public static final String CODE_VIRUS_DETECTED = "VIRUS_DETECTED";
  /** Code surfaced when the scanner could not verify the file (fail-closed). */
  public static final String CODE_SCAN_UNAVAILABLE = "VIRUS_SCAN_UNAVAILABLE";

  private final ClamAvClient client;
  private final boolean enabled;
  private final boolean failOpen;

  public VirusScanner(
      ClamAvClient client,
      @Value("${fsp.clamav.enabled:false}") boolean enabled,
      @Value("${fsp.clamav.fail-open:false}") boolean failOpen) {
    this.client = client;
    this.enabled = enabled;
    this.failOpen = failOpen;
  }

  /**
   * Boot-time health log. When scanning is enabled, PING clamd once after the
   * context is ready so a misconfigured host or a NetworkPolicy blocking egress
   * to the ClamAV service surfaces in the logs at startup rather than on the
   * first upload. Non-fatal: a failed ping only warns — uploads still enforce
   * the fail-open / fail-closed policy.
   */
  @EventListener(ApplicationReadyEvent.class)
  void logScannerHealthAtStartup() {
    if (!enabled) {
      LOG.info("Virus scanning DISABLED (fsp.clamav.enabled=false) — uploads are not scanned.");
      return;
    }
    String target = client.host() + ":" + client.port();
    if (client.ping()) {
      LOG.info("Virus scanning ENABLED — clamd reachable at {} (PONG). fail-open={}",
          target, failOpen);
    } else {
      LOG.warn("Virus scanning ENABLED but clamd did NOT respond at {} — check the ClamAV"
              + " service and any NetworkPolicy blocking egress. Uploads will {} until it's"
              + " reachable.",
          target, failOpen ? "pass UNSCANNED (fail-open)" : "be REJECTED (fail-closed)");
    }
  }

  /**
   * Scan {@code data} and, if it must be rejected, return the
   * {@link Rejection} to surface. Empty means "accept".
   *
   * @param data     the raw uploaded bytes
   * @param filename best-effort filename for logging (may be null)
   */
  public Optional<Rejection> check(byte[] data, String filename) {
    if (!enabled) {
      return Optional.empty();
    }
    // One consistent, greppable verdict line per scan ("clamav scan: ... → X").
    // INFO for the clean happy path (the audit trail), WARN for anything that
    // rejects or couldn't be verified (also visible at INFO).
    int size = data == null ? 0 : data.length;
    String name = filename == null || filename.isBlank() ? "(unnamed)" : filename;
    ScanResult result = client.scan(data);
    switch (result.status()) {
      case CLEAN:
        LOG.info("clamav scan: '{}' ({} bytes) → CLEAN", name, size);
        return Optional.empty();
      case INFECTED:
        LOG.warn("clamav scan: '{}' ({} bytes) → INFECTED ({}) — rejecting",
            name, size, result.signature());
        return Optional.of(new Rejection(
            CODE_VIRUS_DETECTED,
            "Upload rejected: a virus was detected (" + result.signature() + ")."));
      case ERROR:
      default:
        if (failOpen) {
          LOG.warn("clamav scan: '{}' ({} bytes) → UNAVAILABLE ({}) — failing OPEN, allowing",
              name, size, result.detail());
          return Optional.empty();
        }
        LOG.warn("clamav scan: '{}' ({} bytes) → UNAVAILABLE ({}) — failing CLOSED, rejecting",
            name, size, result.detail());
        return Optional.of(new Rejection(
            CODE_SCAN_UNAVAILABLE,
            "Upload rejected: the virus scanner could not verify this file."
                + " Try again shortly."));
    }
  }

  /**
   * Throw-style convenience for callers that don't collect a result
   * list. Throws {@link VirusDetectedException} (→ HTTP 422) when
   * {@link #check} returns a rejection.
   */
  public void scanOrThrow(byte[] data, String filename) {
    check(data, filename).ifPresent(rejection -> {
      throw new VirusDetectedException(rejection);
    });
  }

  /**
   * An upload rejection: a machine-readable {@code code} plus a
   * user-facing {@code message}.
   */
  public record Rejection(String code, String message) {}
}
