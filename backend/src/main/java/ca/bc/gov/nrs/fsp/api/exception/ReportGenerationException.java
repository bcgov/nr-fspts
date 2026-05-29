package ca.bc.gov.nrs.fsp.api.exception;

/**
 * Thrown when JasperReports fails to compile, fill, or export a
 * report. The {@link FspReportController} exception handler maps this
 * to HTTP 502 — the downstream "service" being Jasper itself rather
 * than something user-correctable.
 */
public class ReportGenerationException extends RuntimeException {
  public ReportGenerationException(String message) {
    super(message);
  }

  public ReportGenerationException(String message, Throwable cause) {
    super(message, cause);
  }
}
