package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Each procedure returns a single REF CURSOR. Column shapes vary, so rows are
 * surfaced as ordered Maps of column-name → value.
 */
@Repository
public class FspCodeListsDaoImpl extends AbstractStoredProcedureDao implements FspCodeListsDao {

  public FspCodeListsDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  private List<Map<String, Object>> callOneInOneCursor(String procedure, String input) {
    String call = "{call " + PACKAGE_NAME + "." + procedure + "(?,?)}";
    return executeCall(call,
        cs -> {
          setInOutString(cs, 1, input);
          registerOutCursor(cs, 2);
        },
        cs -> readCursor(cs, 2, FspCodeListsDaoImpl::rowToMap));
  }

  private List<Map<String, Object>> callCursorOnly(String procedure) {
    String call = "{call " + PACKAGE_NAME + "." + procedure + "(?)}";
    return executeCall(call,
        cs -> registerOutCursor(cs, 1),
        cs -> readCursor(cs, 1, FspCodeListsDaoImpl::rowToMap));
  }

  private static Map<String, Object> rowToMap(ResultSet rs) throws java.sql.SQLException {
    ResultSetMetaData md = rs.getMetaData();
    Map<String, Object> row = new LinkedHashMap<>(md.getColumnCount());
    for (int i = 1; i <= md.getColumnCount(); i++) {
      row.put(md.getColumnLabel(i), rs.getObject(i));
    }
    return row;
  }

  @Override public List<Map<String, Object>> getFspAmendmentNumbers(String pFspId) {
    return callOneInOneCursor("get_fsp_amendment_numbers", pFspId);
  }

  @Override public Map<String, String> getFspAmendmentTypeCodes(String pFspId) {
    // Direct read alongside the code-list proc (which doesn't expose the
    // amendment type). fsp_id is a NUMBER column — bind it as a long so
    // Oracle uses the PK index instead of an implicit string conversion.
    long fspId;
    try {
      fspId = Long.parseLong(pFspId.trim());
    } catch (NumberFormatException | NullPointerException e) {
      return Map.of();
    }
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(
        "SELECT DISTINCT fsp_amendment_number AS num, fsp_amendment_code AS code "
            + "  FROM the.forest_stewardship_plan "
            + " WHERE fsp_id = ?", fspId);
    Map<String, String> out = new HashMap<>(rows.size());
    for (Map<String, Object> row : rows) {
      Object num = row.get("NUM");
      Object code = row.get("CODE");
      if (num instanceof Number n) {
        out.put(Integer.toString(n.intValue()), code == null ? null : code.toString().trim());
      }
    }
    return out;
  }

  @Override public List<Map<String, Object>> getAttachReferenceList(String pFspId) {
    return callOneInOneCursor("get_attach_reference_list", pFspId);
  }

  @Override public List<Map<String, Object>> getFspAttachmentTypeCodes() {
    // Active codes only (SYSDATE BETWEEN effective_date AND expiry_date).
    // Derived from the cached full snapshot — see allAttachmentTypeRows()
    // for the cache. Filter is done in-memory so the same cached result
    // covers both this method (dropdown) and getFspAttachmentTypeCodeMap()
    // (label lookup; needs ALL rows so retired codes still resolve their
    // human-friendly description on legacy attachment rows).
    Instant now = Instant.now();
    return allAttachmentTypeRows().stream()
        .filter(r -> withinEffectiveWindow(r, now))
        .map(r -> {
          Map<String, Object> out = new LinkedHashMap<>(2);
          out.put("code", r.get("code"));
          out.put("description", r.get("description"));
          return out;
        })
        .toList();
  }

  /**
   * Unfiltered {@code typeCode → description} map for every row in
   * {@code FSP_ATTACHMENT_TYPE_CODE} (including retired ones). Used by
   * the AttachmentsService to label each attachment row with the
   * database description instead of a hardcoded string. Backed by the
   * same 30-min cache as {@link #getFspAttachmentTypeCodes()} — one
   * Oracle round-trip per pod every 30 minutes covers both flows.
   */
  public Map<String, String> getFspAttachmentTypeCodeMap() {
    Map<String, String> out = new HashMap<>();
    for (Map<String, Object> row : allAttachmentTypeRows()) {
      Object code = row.get("code");
      Object desc = row.get("description");
      if (code != null) {
        out.put(code.toString(), desc == null ? null : desc.toString());
      }
    }
    return Map.copyOf(out);
  }

  // ── Cached attachment-type lookup ────────────────────────────────
  // FSP_ATTACHMENT_TYPE_CODE is reference data that changes on the
  // order of DBA-coordinated releases (i.e. essentially never). Cache
  // the full row set for 30 minutes so neither the upload-dialog
  // dropdown nor the per-attachment label render fires a query per
  // call. List.copyOf snapshots are immutable, so concurrent readers
  // are safe without locking.
  private static final Duration ATTACHMENT_TYPE_TTL = Duration.ofMinutes(30);
  private volatile List<Map<String, Object>> attachmentTypeRowsCache = null;
  private volatile Instant attachmentTypeRowsCachedAt = Instant.EPOCH;

  private List<Map<String, Object>> allAttachmentTypeRows() {
    List<Map<String, Object>> cached = attachmentTypeRowsCache;
    if (cached != null
        && Duration.between(attachmentTypeRowsCachedAt, Instant.now())
            .compareTo(ATTACHMENT_TYPE_TTL) < 0) {
      return cached;
    }
    List<Map<String, Object>> fresh = jdbcTemplate.queryForList(
        "SELECT fsp_attachment_type_code AS code, description, "
            + "       effective_date, expiry_date "
            + "  FROM the.fsp_attachment_type_code "
            + " ORDER BY description");
    // Never cache an empty result. A transient empty read (DB grant/
    // visibility blip) would otherwise poison the cache for the full TTL
    // and blank the Add-Attachment dropdown for 30 minutes. On empty,
    // leave the cache untouched — keep serving the last good snapshot if
    // we have one, and re-query on the next call until a non-empty fetch
    // refreshes it.
    if (fresh.isEmpty()) {
      return cached != null ? cached : fresh;
    }
    attachmentTypeRowsCache = List.copyOf(fresh);
    attachmentTypeRowsCachedAt = Instant.now();
    return attachmentTypeRowsCache;
  }

  private static boolean withinEffectiveWindow(Map<String, Object> row, Instant now) {
    java.sql.Timestamp eff = (java.sql.Timestamp) row.get("EFFECTIVE_DATE");
    java.sql.Timestamp exp = (java.sql.Timestamp) row.get("EXPIRY_DATE");
    // Some Oracle drivers return uppercased aliased names — try both.
    if (eff == null) eff = (java.sql.Timestamp) row.get("effective_date");
    if (exp == null) exp = (java.sql.Timestamp) row.get("expiry_date");
    boolean afterStart = eff == null || !now.isBefore(eff.toInstant());
    boolean beforeEnd = exp == null || !now.isAfter(exp.toInstant());
    return afterStart && beforeEnd;
  }

  @Override public List<Map<String, Object>> getOrgUnitFiltered(String pOrgUnitFilter) {
    // p_org_unit_filter is IN-only (PARAM_IN), p_org_unit is INOUT cursor
    String call = "{call " + PACKAGE_NAME + ".get_org_unit_filtered(?,?)}";
    return executeCall(call,
        cs -> {
          cs.setString(1, pOrgUnitFilter);
          registerOutCursor(cs, 2);
        },
        cs -> readCursor(cs, 2, FspCodeListsDaoImpl::rowToMap));
  }

  @Override public List<Map<String, Object>> getDistrictNo() {
    return callCursorOnly("get_district_no");
  }

  @Override public List<Map<String, Object>> getTreeSizeUnitCd() {
    return callCursorOnly("get_tree_size_unit_cd");
  }

  @Override public List<Map<String, Object>> getSilvTreeSpCd() {
    return callCursorOnly("get_silv_tree_sp_cd");
  }

  @Override public List<Map<String, Object>> getStatuteCd() {
    return callCursorOnly("get_statute_cd");
  }

  @Override public List<Map<String, Object>> getFspStatusCode() {
    return callCursorOnly("get_fsp_status_code");
  }

  @Override public List<Map<String, Object>> getStdRegimeStatusCode() {
    return callCursorOnly("get_std_regime_status_code");
  }
}
