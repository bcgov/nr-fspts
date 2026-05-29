package ca.bc.gov.nrs.fsp.api.service.v1.report;

import ca.bc.gov.nrs.fsp.api.struct.v1.report.FspReportFormat;
import java.util.Arrays;
import java.util.Optional;

/**
 * Catalogue of report templates that ship with the backend. The
 * {@code name()} entry (e.g. {@code REPORT_FSP_SUMMARY}) is also the
 * filename of the JRXML on the classpath under {@code reports/} — see
 * {@link FspReportService#compileTemplate}. {@code id} is the
 * front-end-facing route token ({@code /api/v1/fsp/reports/{id}}).
 *
 * <p>Mirrors nr-rept's ReptReportDefinition pattern. Add new entries
 * here when wiring more reports; the matching JRXML must exist under
 * {@code src/main/resources/reports/}.</p>
 */
public enum FspReportDefinition {
  /** RDD001 — FSPRpt01 PDF FSP Summary Report. */
  REPORT_FSP_SUMMARY("fsp-summary", "FSP_Summary_Report"),
  /** FSPRpt02 — Stocking Standards Report (PDF / CSV). */
  REPORT_FSP_STOCKING_STANDARDS("fsp-stocking-standards", "FSP_Stocking_Standards_Report");

  private final String id;
  private final String defaultFilename;

  FspReportDefinition(String id, String defaultFilename) {
    this.id = id;
    this.defaultFilename = defaultFilename;
  }

  public String getId() {
    return id;
  }

  public String resolveFilename(FspReportFormat format) {
    return defaultFilename + "." + format.getExtension();
  }

  public static FspReportDefinition fromId(String reportId) {
    return Optional
        .ofNullable(reportId)
        .flatMap(id -> Arrays.stream(values()).filter(def -> def.id.equalsIgnoreCase(id)).findFirst())
        .orElseThrow(() -> new IllegalArgumentException("Unknown report id: " + reportId));
  }
}
