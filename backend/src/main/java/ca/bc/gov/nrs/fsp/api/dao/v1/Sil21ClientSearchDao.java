package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps Oracle package THE.PKG_SIL21_CLIENT_SEARCH (legacy:
 * sil/common/data/pkgdefinitions/PkgSil21ClientSearch.java).
 *
 * <p>get_client_search takes five IN VARCHAR criteria (any may be null
 * for "no filter on this field") and returns a single REF CURSOR with
 * ten VARCHAR columns. The proc has no native pagination — full result
 * set comes back in one cursor; pagination is applied in the service
 * layer just like FSP_100_SEARCH.</p>
 */
public interface Sil21ClientSearchDao {

  String PACKAGE_NAME = "PKG_SIL21_CLIENT_SEARCH";
  String PROCEDURE_NAME = "get_client_search";

  /** Single cursor row from get_client_search. All columns are VARCHAR. */
  record Row(
      String clientNumber,
      String clientAcronym,
      String displayClientNumber,
      String clientName,
      String legalFirstName,
      String legalMiddleName,
      String clientLocnCode,
      String clientLocnName,
      String city,
      String clientStatusCode
  ) {}

  List<Row> getClientSearch(
      String pClientNumber,
      String pClientAcronym,
      String pClientName,
      String pLegalFirstName,
      String pLegalMiddleName);
}
