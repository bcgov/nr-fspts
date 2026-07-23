package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao;
import oracle.jdbc.OracleTypes;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.CallableStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

@Repository
public class FspValidationDaoImpl implements FspValidationDao {

  private final JdbcTemplate jdbc;

  public FspValidationDaoImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /**
   * Everything runs inside a single anonymous PL/SQL block: reset →
   * validate → open results cursor → reset. {@code FSP_ERROR_MESSAGES_TEMP}
   * is a {@code GLOBAL TEMPORARY TABLE ON COMMIT DELETE ROWS}, so any
   * commit between the {@code set_error} inserts and the cursor open
   * would wipe the rows. Doing the inserts AND opening the cursor in
   * the same block guarantees the cursor sees what validate_fsp wrote.
   *
   * <p>The cursor stays open across the {@code call} boundary — JDBC
   * reads from it after the block returns, which keeps the transaction
   * implicitly open. We drain it then close.
   */
  @Override
  @Transactional
  public List<ValidationError> validate(long fspId, long amendmentNumber) {
    return jdbc.execute((java.sql.Connection con) -> {
      try (CallableStatement cs = con.prepareCall(
          "DECLARE "
              + "  v_valid BOOLEAN; "
              + "  v_count NUMBER; "
              + "BEGIN "
              + "  fsp_error.reset_errors; "
              + "  fsp_common_validation.validate_fsp(?, ?, 'PROD', v_valid); "
              // Cover two checks validate_fsp's source carries as
              // dead code (cursor FOR loop never raises NO_DATA_FOUND
              // on an empty cursor, so the WHEN NO_DATA_FOUND branches
              // that set FSP.NO.AGREEMENT.HOLDER / FSP.NO.ORG.UNIT
              // never trigger). MAINLINE(SUBMIT) catches them via the
              // SAVE proc's count check; the preflight replicates that
              // here so we match end-to-end submission behaviour.
              + "  SELECT COUNT(*) INTO v_count "
              + "    FROM fsp_agreement_holder "
              + "   WHERE fsp_id = ? AND fsp_amendment_number = ?; "
              + "  IF v_count = 0 THEN fsp_error.set_error('FSP.NO.AGREEMENT.HOLDER'); END IF; "
              + "  SELECT COUNT(*) INTO v_count "
              + "    FROM fsp_org_unit "
              + "   WHERE fsp_id = ? AND fsp_amendment_number = ?; "
              + "  IF v_count = 0 THEN fsp_error.set_error('FSP.NO.ORG.UNIT'); END IF; "
              + "  OPEN ? FOR "
              + "    SELECT error_key, "
              + "           fsp_common.format_error_message(error_message, error_parameters) "
              + "      FROM fsp_error_messages_temp "
              + "     ORDER BY entry_timestamp, fsp_error_messages_id; "
              + "END;")) {
        cs.setLong(1, fspId);
        cs.setLong(2, amendmentNumber);
        cs.setLong(3, fspId);
        cs.setLong(4, amendmentNumber);
        cs.setLong(5, fspId);
        cs.setLong(6, amendmentNumber);
        cs.registerOutParameter(7, OracleTypes.CURSOR);
        cs.execute();
        List<ValidationError> out = new ArrayList<>();
        try (ResultSet rs = (ResultSet) cs.getObject(7)) {
          while (rs.next()) {
            out.add(new ValidationError(rs.getString(1), rs.getString(2)));
          }
        }
        // Belt-and-suspenders cleanup — the GTT will be wiped on
        // commit anyway, but reset_errors also clears g_error_number
        // back to 1 in the fsp_error package state.
        try (CallableStatement reset = con.prepareCall(
            "BEGIN fsp_error.reset_errors; END;")) {
          reset.execute();
        }
        return out;
      }
    });
  }

  /**
   * One anonymous block reads the indicator/code/transition columns and
   * evaluates the three {@code has_*_changes} functions (which return PL/SQL
   * BOOLEAN — not selectable in plain SQL, hence the CASE→'Y'/'N' mapping
   * through OUT binds). The ids are bound once into locals so the function
   * calls reuse them. NO_DATA_FOUND (no such FSP/amendment) leaves the OUT
   * params null, which the record surfaces as null indicators.
   */
  @Override
  @Transactional(readOnly = true)
  public UpdateIndicatorState getUpdateIndicatorState(long fspId, long amendmentNumber) {
    return jdbc.execute((java.sql.Connection con) -> {
      try (CallableStatement cs = con.prepareCall(
          "DECLARE "
              + "  v_id  NUMBER := ?; "
              + "  v_amd NUMBER := ?; "
              + "  v_amd_code   VARCHAR2(3); "
              + "  v_transition VARCHAR2(1); "
              + "  v_fdu_ind    VARCHAR2(1); "
              + "  v_ia_ind     VARCHAR2(1); "
              + "  v_ss_ind     VARCHAR2(1); "
              + "BEGIN "
              + "  SELECT fsp_amendment_code, NVL(transition_ind,'N'), "
              + "         NVL(fdu_update_ind,'N'), NVL(identified_areas_update_ind,'N'), "
              + "         NVL(stocking_standard_update_ind,'N') "
              + "    INTO v_amd_code, v_transition, v_fdu_ind, v_ia_ind, v_ss_ind "
              + "    FROM forest_stewardship_plan "
              + "   WHERE fsp_id = v_id AND fsp_amendment_number = v_amd; "
              + "  ? := v_amd_code; "
              + "  ? := v_transition; "
              + "  ? := v_fdu_ind; "
              + "  ? := v_ia_ind; "
              + "  ? := v_ss_ind; "
              + "  ? := CASE WHEN fsp_common_db.has_fdu_changes(v_id, v_amd) THEN 'Y' ELSE 'N' END; "
              + "  ? := CASE WHEN fsp_common_db.has_identified_area_changes(v_id, v_amd) THEN 'Y' ELSE 'N' END; "
              + "  ? := CASE WHEN fsp_common_db.has_stocking_standard_changes(v_id, v_amd) THEN 'Y' ELSE 'N' END; "
              + "EXCEPTION WHEN NO_DATA_FOUND THEN NULL; "
              + "END;")) {
        cs.setLong(1, fspId);
        cs.setLong(2, amendmentNumber);
        cs.registerOutParameter(3, java.sql.Types.VARCHAR);   // amendment code
        cs.registerOutParameter(4, java.sql.Types.VARCHAR);   // transition ind
        cs.registerOutParameter(5, java.sql.Types.VARCHAR);   // fdu update ind
        cs.registerOutParameter(6, java.sql.Types.VARCHAR);   // ia update ind
        cs.registerOutParameter(7, java.sql.Types.VARCHAR);   // ss update ind
        cs.registerOutParameter(8, java.sql.Types.VARCHAR);   // fdu has changes
        cs.registerOutParameter(9, java.sql.Types.VARCHAR);   // ia has changes
        cs.registerOutParameter(10, java.sql.Types.VARCHAR);  // ss has changes
        cs.execute();
        return new UpdateIndicatorState(
            cs.getString(3),
            cs.getString(4),
            cs.getString(5),
            "Y".equals(cs.getString(8)),
            cs.getString(6),
            "Y".equals(cs.getString(9)),
            cs.getString(7),
            "Y".equals(cs.getString(10)));
      }
    });
  }
}
