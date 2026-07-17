package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class Fsp501StdsSrchDaoImpl extends AbstractStoredProcedureDao implements Fsp501StdsSrchDao {

  // 23 positional params: 21 INOUT VARCHAR criteria + p_error_message + p_results cursor.
  private static final int PARAM_COUNT = 23;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp501StdsSrchDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result mainline(
      String pAction, String pDefaultStandard, String pStandardsRegimeStatusCode,
      String pOrgUnitNo, String pFspId, String pClientNumber, String pClientName,
      String pStandardsRegimeId, String pStandardsRegimeName, String pStandardsObjective,
      String pPreferredSpecies, String pAcceptableSpecies,
      String pExpiryDtFrom, String pExpiryDtTo,
      String pBgcZoneCode, String pBgcSubzoneCode, String pBgcVariant, String pBgcPhase,
      String pBecSiteSeriesCd, String pBecSiteSeriesPhaseCd, String pBecSeral,
      int maxRows) {
    return executeCall(CALL,
        cs -> {
          setInOutString(cs, 1, pAction);
          setInOutString(cs, 2, pDefaultStandard);
          setInOutString(cs, 3, pStandardsRegimeStatusCode);
          setInOutString(cs, 4, pOrgUnitNo);
          setInOutString(cs, 5, pFspId);
          setInOutString(cs, 6, pClientNumber);
          setInOutString(cs, 7, pClientName);
          setInOutString(cs, 8, pStandardsRegimeId);
          setInOutString(cs, 9, pStandardsRegimeName);
          setInOutString(cs, 10, pStandardsObjective);
          setInOutString(cs, 11, pPreferredSpecies);
          setInOutString(cs, 12, pAcceptableSpecies);
          setInOutString(cs, 13, pExpiryDtFrom);
          setInOutString(cs, 14, pExpiryDtTo);
          setInOutString(cs, 15, pBgcZoneCode);
          setInOutString(cs, 16, pBgcSubzoneCode);
          setInOutString(cs, 17, pBgcVariant);
          setInOutString(cs, 18, pBgcPhase);
          setInOutString(cs, 19, pBecSiteSeriesCd);
          setInOutString(cs, 20, pBecSiteSeriesPhaseCd);
          setInOutString(cs, 21, pBecSeral);
          setInOutString(cs, 22, null);    // P_ERROR_MESSAGE
          registerOutCursor(cs, 23);       // P_RESULTS
        },
        cs -> {
          List<Row> rows = readCursor(cs, 23, rs -> new Row(
              rs.getString("STANDARDS_REGIME_ID"),
              rs.getString("STANDARDS_REGIME_NAME"),
              rs.getString("STANDARDS_OBJECTIVE"),
              rs.getString("BGC"),
              rs.getString("CLIENT_NUMBER"),
              rs.getString("STATUS"),
              rs.getString("EXPIRY_DATE"),
              rs.getString("FSP_ID_LIST"),
              // MAINLINE's result cursor doesn't surface mof_default_standard_ind
              // (it's only a scalar OUT echo of the search filter). This proc DAO
              // is superseded by Fsp501StdsSrchDirectDao — which the search
              // service actually uses and which DOES project the flag — so null
              // here is harmless.
              null
          ), maxRows);
          Header header = new Header(
              cs.getString(1), cs.getString(2), cs.getString(3), cs.getString(4),
              cs.getString(5), cs.getString(6), cs.getString(7), cs.getString(8),
              cs.getString(9), cs.getString(10), cs.getString(11), cs.getString(12),
              cs.getString(13), cs.getString(14), cs.getString(15), cs.getString(16),
              cs.getString(17), cs.getString(18), cs.getString(19), cs.getString(20),
              cs.getString(21), cs.getString(22));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, header.pErrorMessage());
          return new Result(header, rows);
        });
  }
}
