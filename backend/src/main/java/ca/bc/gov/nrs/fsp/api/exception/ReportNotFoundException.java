package ca.bc.gov.nrs.fsp.api.exception;

/**
 * Thrown when a requested report id has no corresponding JRXML
 * template on the classpath. The {@link FspReportController}
 * exception handler maps this to HTTP 404.
 */
public class ReportNotFoundException extends RuntimeException {
  public ReportNotFoundException(String reportId) {
    super("Report not found: " + reportId);
  }

  public ReportNotFoundException(String reportId, Throwable cause) {
    super("Report not found: " + reportId, cause);
  }
}
