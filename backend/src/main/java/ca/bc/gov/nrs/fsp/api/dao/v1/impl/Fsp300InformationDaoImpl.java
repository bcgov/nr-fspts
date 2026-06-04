package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.LicenseeArrayElement;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.OrgUnitArrayElement;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class Fsp300InformationDaoImpl extends AbstractStoredProcedureDao implements Fsp300InformationDao {

  private static final int PARAM_COUNT = 46;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp300InformationDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result mainline(
      String pAction, String pFspId, String pNewFspId, String pFspPlanName,
      @Nullable List<OrgUnitArrayElement> pFspOrgUnits,
      String pFspStatusCode, String pFspStatusDesc,
      String pFspAmendmentNumber, String pNewFspAmendmentNumber,
      String pUserClientNumber, String pUserRole, String pSubmissionId,
      String pFspExpiryDate, String pAmendmentName, String pAmendmentEfftvDate,
      String pNewFspPlanName, String pNewAmendmentName,
      String pFspPlanStartDate, String pFspPlanTermYears, String pFspPlanTermMonths,
      String pFspPlanEndDate, String pFspPlanSubmissionDate,
      String pFspContactName, String pFspTelephoneNumber, String pFspEmailAddress,
      String pFduUpdateInd, String pIdentifiedAreasUpdateInd, String pStockingStandardUpdateInd,
      String pApprovalRequiredInd, String pTransitionInd,
      String pFrpa197electionInd, String pAmendmentAuthority,
      @Nullable List<LicenseeArrayElement> pFspLicenses,
      @Nullable List<OrgUnitArrayElement> pOrgUnits,
      String pFspStatus, String pEntryUserid, String pAmendmentReason,
      String pFspRejectedByEsfInd, String pFspUnapprovedAmendsInd, String pFspExtensionStat,
      String pFspAmendmentCode, String pFspAmendmentDesc, String pIsExpiryChanged,
      String pRevisionCount, String pUpdateUserid) {

    return executeCall(CALL,
        cs -> {
          setInOutString(cs, 1, pAction);
          setInOutString(cs, 2, pFspId);
          setInOutString(cs, 3, pNewFspId);
          setInOutString(cs, 4, pFspPlanName);
          setInOutOrgUnits(cs, 5, pFspOrgUnits);
          setInOutString(cs, 6, pFspStatusCode);
          setInOutString(cs, 7, pFspStatusDesc);
          setInOutString(cs, 8, pFspAmendmentNumber);
          setInOutString(cs, 9, pNewFspAmendmentNumber);
          setInOutString(cs, 10, pUserClientNumber);
          setInOutString(cs, 11, pUserRole);
          setInOutString(cs, 12, pSubmissionId);
          setInOutString(cs, 13, pFspExpiryDate);
          setInOutString(cs, 14, pAmendmentName);
          setInOutString(cs, 15, pAmendmentEfftvDate);
          setInOutString(cs, 16, pNewFspPlanName);
          setInOutString(cs, 17, pNewAmendmentName);
          setInOutString(cs, 18, pFspPlanStartDate);
          setInOutString(cs, 19, pFspPlanTermYears);
          setInOutString(cs, 20, pFspPlanTermMonths);
          setInOutString(cs, 21, pFspPlanEndDate);
          setInOutString(cs, 22, pFspPlanSubmissionDate);
          setInOutString(cs, 23, pFspContactName);
          setInOutString(cs, 24, pFspTelephoneNumber);
          setInOutString(cs, 25, pFspEmailAddress);
          setInOutString(cs, 26, pFduUpdateInd);
          setInOutString(cs, 27, pIdentifiedAreasUpdateInd);
          setInOutString(cs, 28, pStockingStandardUpdateInd);
          setInOutString(cs, 29, pApprovalRequiredInd);
          setInOutString(cs, 30, pTransitionInd);
          setInOutString(cs, 31, pFrpa197electionInd);
          setInOutString(cs, 32, pAmendmentAuthority);
          setInOutLicensees(cs, 33, pFspLicenses);
          setInOutOrgUnits(cs, 34, pOrgUnits);
          setInOutString(cs, 35, pFspStatus);
          setInOutString(cs, 36, pEntryUserid);
          setInOutString(cs, 37, pAmendmentReason);
          setInOutString(cs, 38, pFspRejectedByEsfInd);
          setInOutString(cs, 39, pFspUnapprovedAmendsInd);
          setInOutString(cs, 40, pFspExtensionStat);
          setInOutString(cs, 41, pFspAmendmentCode);
          setInOutString(cs, 42, pFspAmendmentDesc);
          setInOutString(cs, 43, pIsExpiryChanged);
          setInOutString(cs, 44, pRevisionCount);
          setInOutString(cs, 45, pUpdateUserid);
          setInOutString(cs, 46, null);  // P_ERROR_MESSAGE
        },
        cs -> {
          Result r = new Result(
              cs.getString(1),  cs.getString(2),  cs.getString(3),  cs.getString(4),
              readOrgUnits(cs, 5),
              cs.getString(6),  cs.getString(7),  cs.getString(8),  cs.getString(9),
              cs.getString(10), cs.getString(11), cs.getString(12), cs.getString(13),
              cs.getString(14), cs.getString(15), cs.getString(16), cs.getString(17),
              cs.getString(18), cs.getString(19), cs.getString(20), cs.getString(21),
              cs.getString(22), cs.getString(23), cs.getString(24), cs.getString(25),
              cs.getString(26), cs.getString(27), cs.getString(28), cs.getString(29),
              cs.getString(30), cs.getString(31), cs.getString(32),
              readLicensees(cs, 33),
              readOrgUnits(cs, 34),
              cs.getString(35), cs.getString(36), cs.getString(37),
              cs.getString(38), cs.getString(39), cs.getString(40), cs.getString(41),
              cs.getString(42), cs.getString(43), cs.getString(44), cs.getString(45),
              cs.getString(46));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, r.pErrorMessage());
          return r;
        });
  }

  @Override
  public int setPlanStartDateIfNull(long fspId, long amendmentNumber) {
    return jdbcTemplate.update(
        "UPDATE forest_stewardship_plan "
            + "   SET plan_start_date = SYSDATE "
            + " WHERE fsp_id = ? "
            + "   AND fsp_amendment_number = ? "
            + "   AND plan_start_date IS NULL",
        fspId, amendmentNumber);
  }
}
