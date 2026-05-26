package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Sil21ClientSearchDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.util.List;

/**
 * Six positional parameters total:
 * <ol>
 *   <li>p_client_number      IN VARCHAR2</li>
 *   <li>p_client_acronym     IN VARCHAR2</li>
 *   <li>p_client_name        IN VARCHAR2 (last name; legacy form labels it
 *       "Last Name" — column is CLIENT_NAME on FOREST_CLIENT)</li>
 *   <li>p_legal_first_name   IN VARCHAR2</li>
 *   <li>p_legal_middle_name  IN VARCHAR2</li>
 *   <li>p_client_search_results IN OUT REF CURSOR</li>
 * </ol>
 *
 * Empty strings are passed through as-is; the proc treats both NULL and
 * an empty-string equivalently in its WHERE clauses (NVL/UPPER pattern),
 * so no defensive empty-to-null conversion is needed here.
 */
@Repository
public class Sil21ClientSearchDaoImpl extends AbstractStoredProcedureDao implements Sil21ClientSearchDao {

  public Sil21ClientSearchDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public List<Row> getClientSearch(
      String pClientNumber,
      String pClientAcronym,
      String pClientName,
      String pLegalFirstName,
      String pLegalMiddleName) {
    String sql = callSql(PACKAGE_NAME, PROCEDURE_NAME, 6);
    return executeCall(sql,
        cs -> {
          // Params 1..5 are IN-only (PARAM_IN in the legacy descriptor)
          // so setString without registerOutParameter is correct.
          cs.setString(1, nullIfBlank(pClientNumber));
          cs.setString(2, nullIfBlank(pClientAcronym));
          cs.setString(3, nullIfBlank(pClientName));
          cs.setString(4, nullIfBlank(pLegalFirstName));
          cs.setString(5, nullIfBlank(pLegalMiddleName));
          registerOutCursor(cs, 6);
        },
        cs -> readCursor(cs, 6, rs -> new Row(
            rs.getString("CLIENT_NUMBER"),
            rs.getString("CLIENT_ACRONYM"),
            rs.getString("DISPLAY_CLIENT_NUMBER"),
            rs.getString("CLIENT_NAME"),
            rs.getString("LEGAL_FIRST_NAME"),
            rs.getString("LEGAL_MIDDLE_NAME"),
            rs.getString("CLIENT_LOCN_CODE"),
            rs.getString("CLIENT_LOCN_NAME"),
            rs.getString("CITY"),
            rs.getString("CLIENT_STATUS_CODE")
        )));
  }

  // The proc's WHERE clauses are `(p_x IS NULL OR ...)` — passing an
  // empty string would attempt `LIKE UPPER('%')` which works for some
  // fields but matches nothing for an exact-equals check on others.
  // Normalize blanks to null at the boundary so the proc's null-OR
  // short-circuit fires for every criterion.
  private static String nullIfBlank(String s) {
    if (s == null) return null;
    String trimmed = s.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
