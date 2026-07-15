package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;
import java.util.Map;

/**
 * Wraps Oracle package FSP_CODE_LISTS (legacy: pkgdefinitions/PkgFspCodeLists.java).
 * Each method calls a different procedure that returns a single REF CURSOR.
 * Cursor row column names vary per lookup, so we return generic Map rows.
 */
public interface FspCodeListsDao {

  String PACKAGE_NAME = "FSP_CODE_LISTS";

  List<Map<String, Object>> getFspAmendmentNumbers(String pFspId);

  /**
   * {@code amendmentNumber → fsp_amendment_code} (ORG / AMD / RPL) for every
   * version of an FSP. The {@code get_fsp_amendment_numbers} cursor only
   * yields the number + "Original" label, so this direct read supplies the
   * amendment TYPE the version picker appends as context (e.g. "1 -
   * Amendment", "2 - Replacement"). Keyed by the number as a string to line
   * up with the CodeOption codes.
   */
  Map<String, String> getFspAmendmentTypeCodes(String pFspId);

  List<Map<String, Object>> getAttachReferenceList(String pFspId);

  /**
   * Active rows from THE.FSP_ATTACHMENT_TYPE_CODE — the actual lookup
   * table for attachment categories (the misleadingly-named
   * {@code get_attach_reference_list} proc returns prior OTHR-type
   * attachments for cross-FSP linking, not categories). Filters on
   * effective_date / expiry_date so retired codes don't appear.
   */
  List<Map<String, Object>> getFspAttachmentTypeCodes();

  /**
   * Unfiltered {@code typeCode → description} map for every row in
   * {@code FSP_ATTACHMENT_TYPE_CODE} (active AND retired). Backs the
   * per-attachment category label so legacy rows carrying a retired
   * code still resolve to their human-friendly description rather
   * than falling back to the bare code. Cached server-side.
   */
  Map<String, String> getFspAttachmentTypeCodeMap();

  List<Map<String, Object>> getOrgUnitFiltered(String pOrgUnitFilter);

  List<Map<String, Object>> getDistrictNo();

  List<Map<String, Object>> getTreeSizeUnitCd();

  List<Map<String, Object>> getSilvTreeSpCd();

  List<Map<String, Object>> getStatuteCd();

  List<Map<String, Object>> getFspStatusCode();

  List<Map<String, Object>> getStdRegimeStatusCode();
}
