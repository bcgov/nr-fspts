package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps THE.FSP_600_MAP.GET — the FDU list shown on the legacy FDU/Map
 * screen. Delegates the access gate to fsp_tombstone.get the same way
 * FSP_400 and FSP_500 do, plus opens an extra cursor of FDU rows and an
 * OUT scalar carrying the amendment number where the FDU geometry lives.
 */
public interface Fsp600MapDao {

  String PACKAGE_NAME = "FSP_600_MAP";
  String PROCEDURE_NAME = "GET";

  Result get(String fspId, String userClientNumber, String userRole);

  record Result(
      String fduAmendmentNumber,
      List<FduRow> fdus,
      String errorMessage
  ) {}

  /**
   * One row of the p_fdu_map_results cursor. The proc returns
   * {@code fdu_licences} as a comma-separated string of licence numbers
   * (computed via get_fdu_licenses) — kept as a string here; the front
   * end can split if it needs individual chips.
   */
  record FduRow(
      String fduId,
      String fduName,
      String licences
  ) {}
}
