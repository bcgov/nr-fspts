package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
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

  @Override public List<Map<String, Object>> getAttachReferenceList(String pFspId) {
    return callOneInOneCursor("get_attach_reference_list", pFspId);
  }

  @Override public List<Map<String, Object>> getFspAttachmentTypeCodes() {
    // SYSDATE BETWEEN effective_date AND expiry_date keeps the list to
    // active codes only. ORDER BY description so the dropdown reads
    // alphabetically rather than by an arbitrary insert order.
    return jdbcTemplate.queryForList(
        "SELECT fsp_attachment_type_code AS code, description "
            + "  FROM the.fsp_attachment_type_code "
            + " WHERE SYSDATE BETWEEN effective_date AND expiry_date "
            + " ORDER BY description");
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
