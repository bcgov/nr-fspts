package ca.bc.gov.nrs.fsp.api.service.v1.report;

import ca.bc.gov.nrs.fsp.api.struct.v1.report.FspReportRequestDto;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Translates a {@link FspReportRequestDto} into the parameter Map
 * Jasper feeds to the underlying stored procedure / SQL. Each report
 * gets its own builder so the dispatch stays explicit — adding a new
 * report definition means adding a switch arm here.
 *
 * <p>Parameter names use the lowercase {@code p_*} convention the
 * legacy JRXMLs already declare (e.g. {@code p_org_unit_no}). Adding
 * a new report? Inspect its {@code &lt;parameter name="..."&gt;}
 * declarations and mirror them here — Jasper silently ignores Map
 * entries that don't match a declared parameter, so a typo just shows
 * up as a missing value at fill time.</p>
 *
 * <p>The IDIR user-id parameter ({@code p_userid} / {@code p_user_id})
 * is pulled from the current JWT — legacy JRS resolved this via a
 * {@code LoggedInUser} object that doesn't exist embedded.</p>
 */
@Component
public class FspReportParameterProvider {

  private static final LocalDate DEFAULT_START_DATE = LocalDate.of(1900, 1, 1);
  private static final LocalDate DEFAULT_END_DATE = LocalDate.of(9999, 12, 31);

  private static final String SUBREPORT_DIR_PARAM = "SUBREPORT_DIR";

  public Map<String, Object> buildJasperParameters(
      FspReportDefinition definition,
      FspReportRequestDto request
  ) {
    Map<String, Object> params = switch (definition) {
      case REPORT_FSP_SUMMARY -> paramsFspSummary(request);
      case REPORT_FSP_STOCKING_STANDARDS -> paramsStockingStandards(request);
    };
    params.put(SUBREPORT_DIR_PARAM, resolveSubreportDir());
    return params;
  }

  // ── Per-report parameter builders ────────────────────────────────

  private Map<String, Object> paramsFspSummary(FspReportRequestDto request) {
    Map<String, Object> params = new HashMap<>();
    params.put("p_client_number", trimToEmpty(request.ahClientNumber()));
    // p_client_name is in the proc signature but the front-end form
    // doesn't expose it yet — pass blank. The proc treats blank as
    // "no name filter" the same way it does for the other p_* params.
    params.put("p_client_name", "");
    params.put("p_fsp_id", trimToEmpty(request.fspId()));
    params.put("p_org_unit_no", trimToEmpty(request.orgUnitNo()));
    // JRXML declares these as java.lang.String — the proc expects
    // VARCHAR2 'YYYY-MM-DD' and TO_DATE-coerces internally. Passing a
    // java.util.Date instead throws "wrong number or types of arguments"
    // because JR forwards the declared type via PreparedStatement.
    params.put("p_fsp_start_date", formatDate(request.startDate(), DEFAULT_START_DATE));
    params.put("p_fsp_end_date", formatDate(request.endDate(), DEFAULT_END_DATE));
    params.put("p_userid", currentUserId());
    params.put("p_report_id", "RDD001");
    return params;
  }

  private Map<String, Object> paramsStockingStandards(FspReportRequestDto request) {
    String fspId = trimToEmpty(request.fspId());
    if (fspId.isEmpty()) {
      throw new IllegalArgumentException("fspId is required for the stocking-standards report");
    }
    Map<String, Object> params = new HashMap<>();
    params.put("p_user_id", currentUserId());
    params.put("p_report_id", "RDD009-CSV");
    params.put("p_report_category", "FSP");
    params.put("p_report_name", "FSP Stocking Standards Report");
    params.put("p_org_unit_no", trimToEmpty(request.orgUnitNo()));
    params.put("p_client_number", trimToEmpty(request.ahClientNumber()));
    params.put("p_fsp_id", fspId);
    // Defaults for the rest — caller-supplied overrides can be added
    // to FspReportRequestDto + wired through here as they become needed.
    params.put("p_fsp_amendment_number", "");
    params.put("p_regime_status", "");
    params.put("p_zone", "");
    params.put("p_subzone", "");
    params.put("p_comments_ind", "");
    params.put("p_default_district_standards_ind", "");
    params.put("p_RDD009_order_by_data", defaultIfBlank(request.sortColumn(), ""));
    return params;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private static String currentUserId() {
    return RequestUtil.getCurrentIdir();
  }

  private static String formatDate(LocalDate value, LocalDate fallback) {
    LocalDate effective = value != null ? value : fallback;
    return effective.format(DateTimeFormatter.ISO_LOCAL_DATE);
  }

  private static String trimToEmpty(String value) {
    return value == null ? "" : value.trim();
  }

  private static String defaultIfBlank(String value, String fallback) {
    String trimmed = trimToEmpty(value);
    return trimmed.isEmpty() ? fallback : trimmed;
  }

  /**
   * Filesystem (or {@code jar:}) path of the classpath {@code reports/}
   * directory — JR's built-in {@code SUBREPORT_DIR} parameter expects
   * something it can prefix to a bare filename. Works in both
   * exploded-classes dev runs and packed-jar deploys.
   */
  private static String resolveSubreportDir() {
    try {
      ClassPathResource resource = new ClassPathResource("reports/");
      String url = resource.getURL().toExternalForm();
      if (url.startsWith("file:")) {
        return url.substring("file:".length());
      }
      return url;
    } catch (Exception ignored) {
      return "";
    }
  }
}
