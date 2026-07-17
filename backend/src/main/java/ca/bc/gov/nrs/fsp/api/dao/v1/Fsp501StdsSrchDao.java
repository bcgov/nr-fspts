package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps Oracle package FSP_501_STDS_SRCH (legacy: pkgdefinitions/Fsp501StdsSrch.java).
 * Backs the FSP501 "Standards Search" screen — 21 search criteria
 * (regime status + org unit + FSP id + client + standards meta +
 * species + expiry range + 7 BGC fields), one REF CURSOR result.
 */
public interface Fsp501StdsSrchDao {

  String PACKAGE_NAME = "FSP_501_STDS_SRCH";
  String PROCEDURE_NAME = "MAINLINE";

  /** Echoed-back INOUT VARCHARs from the call (positions 1..21 + #22 error). */
  record Header(
      String pAction,
      String pDefaultStandard,
      String pStandardsRegimeStatusCode,
      String pOrgUnitNo,
      String pFspId,
      String pClientNumber,
      String pClientName,
      String pStandardsRegimeId,
      String pStandardsRegimeName,
      String pStandardsObjective,
      String pPreferredSpecies,
      String pAcceptableSpecies,
      String pExpiryDtFrom,
      String pExpiryDtTo,
      String pBgcZoneCode,
      String pBgcSubzoneCode,
      String pBgcVariant,
      String pBgcPhase,
      String pBecSiteSeriesCd,
      String pBecSiteSeriesPhaseCd,
      String pBecSeral,
      String pErrorMessage
  ) {}

  /** P_RESULTS REF CURSOR row — 8 columns the FSP501 result table renders. */
  record Row(
      String standardsRegimeId,
      String standardsRegimeName,
      String standardsObjective,
      String bgc,
      String clientNumber,
      String status,
      String expiryDate,
      String fspIdList,
      String mofDefaultStandardInd
  ) {}

  record Result(Header header, List<Row> rows) {}

  /**
   * @param maxRows upper bound on cursor drain. 0 = drain everything
   *     (matches FspSearch behaviour — paginate in memory).
   */
  Result mainline(
      String pAction,
      String pDefaultStandard,
      String pStandardsRegimeStatusCode,
      String pOrgUnitNo,
      String pFspId,
      String pClientNumber,
      String pClientName,
      String pStandardsRegimeId,
      String pStandardsRegimeName,
      String pStandardsObjective,
      String pPreferredSpecies,
      String pAcceptableSpecies,
      String pExpiryDtFrom,
      String pExpiryDtTo,
      String pBgcZoneCode,
      String pBgcSubzoneCode,
      String pBgcVariant,
      String pBgcPhase,
      String pBecSiteSeriesCd,
      String pBecSiteSeriesPhaseCd,
      String pBecSeral,
      int maxRows
  );
}
