package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.OrgUnitLookupDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.CodeOption;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Provides dropdown-friendly code lists for the search UI.
 *
 * <p>The underlying procedures ({@code FSP_CODE_LISTS.get_org_unit_filtered},
 * {@code FSP_CODE_LISTS.get_fsp_status_code}) return REF CURSORs whose
 * column shapes aren't documented in the migrated DAO contract. Rather
 * than create a new DTO per cursor, the DAO surfaces each row as a
 * {@code Map<String, Object>} of column-name → value and this service
 * collapses every shape to a single {@link CodeOption} via tolerant
 * lookup against the conventional column names the legacy webADE
 * OptionBean populated from.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CodeListsService {

  // Conventional column names from the legacy OptionBean's getCode() /
  // getExtDescription() / getDescription(). Oracle cursors typically
  // return uppercase column labels but JDBC drivers vary; check both
  // cases. Listed in preference order — first non-blank wins.
  private static final String[] CODE_KEYS = {"CODE", "code", "C_CODE"};
  private static final String[] DESC_KEYS = {
      "EXT_DESCRIPTION", "ext_description",
      "DESCRIPTION", "description",
      "DESC", "desc",
  };

  private final FspCodeListsDao fspCodeListsDao;
  private final OrgUnitLookupDao orgUnitLookupDao;

  /**
   * Org units suitable for the FSP-100 search form's Organization Unit
   * dropdown. Empty filter returns the full list (legacy behaviour);
   * future enhancement could pass the user's district code from the JWT
   * to scope the list, matching what Fsp100SearchForm.setDefaults does.
   */
  public List<CodeOption> getOrgUnits() {
    return fspCodeListsDao.getOrgUnitFiltered("").stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        .toList();
  }

  /**
   * Org units keyed by the 3-letter {@code org_unit_code} (e.g. "DCC")
   * with {@code description} = {@code org_unit_name}. Distinct from
   * {@link #getOrgUnits()}, which keys by the numeric {@code org_unit_no}
   * used by the FSP search filter. This variant powers the SPA's
   * display lookup that expands the comma-separated abbreviation list
   * returned in each search row into human-friendly district names.
   */
  public List<CodeOption> getOrgUnitCodes() {
    return orgUnitLookupDao.findAllCodeNamePairs().stream()
        .map(row -> CodeOption.builder()
            .code(row.get("code"))
            .description(row.get("description"))
            .build())
        .filter(o -> o.getCode() != null)
        .toList();
  }

  /**
   * FSP status codes for the Status dropdown (Draft, Submitted, Approved,
   * Rejected, Expired, etc.). Driven by {@code fsp_status_code} on
   * FSP_CODE_LISTS — single REF CURSOR, no input params.
   */
  public List<CodeOption> getFspStatusCodes() {
    return fspCodeListsDao.getFspStatusCode().stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        .toList();
  }

  /**
   * Amendment numbers available for a given FSP. The cursor's
   * {@code description} column already maps {@code 0 → "Original"};
   * other numbers come back as their integer string. Used by the
   * FSP information page to power the amendment-picker dropdown.
   */
  public List<CodeOption> getFspAmendmentNumbers(String fspId) {
    Map<String, String> typeByNumber = fspCodeListsDao.getFspAmendmentTypeCodes(fspId);
    return fspCodeListsDao.getFspAmendmentNumbers(fspId).stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        .map(o -> withVersionContext(o, typeByNumber))
        .toList();
  }

  /**
   * Appends the amendment TYPE to a version option's label so the picker
   * reads "1 - Amendment", "2 - Replacement", etc. The original (code "0")
   * keeps its plain "Original" label, and any version whose type is unknown
   * or ORG falls back to the bare number the proc supplied.
   */
  private static CodeOption withVersionContext(CodeOption option, Map<String, String> typeByNumber) {
    if ("0".equals(option.getCode())) {
      return option;
    }
    String label = amendmentTypeLabel(typeByNumber.get(option.getCode()));
    if (label == null) {
      return option;
    }
    return CodeOption.builder()
        .code(option.getCode())
        .description(option.getDescription() + " - " + label)
        .build();
  }

  private static String amendmentTypeLabel(String amendmentCode) {
    if (amendmentCode == null) {
      return null;
    }
    return switch (amendmentCode.toUpperCase()) {
      case "AMD" -> "Amendment";
      case "RPL" -> "Replacement";
      default -> null; // ORG or anything unexpected → leave the bare number
    };
  }

  /**
   * Attachment categories available for the given FSP. Backs the
   * Attachments tab's "Add Attachment" dialog dropdown. The legacy
   * cursor is per-FSP because the allowed categories vary by amendment
   * state (e.g. amendments need different doc types than originals).
   */
  /**
   * Returns all active rows from THE.FSP_ATTACHMENT_TYPE_CODE. The
   * {@code fspId} parameter is kept on the signature for the
   * controller path (and future per-FSP filtering) but isn't used
   * server-side — the lookup table is global and the proc named
   * {@code get_attach_reference_list} doesn't actually return
   * categories.
   */
  @SuppressWarnings("unused")
  public List<CodeOption> getAttachmentCategories(String fspId) {
    return fspCodeListsDao.getFspAttachmentTypeCodes().stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        // The identified-areas feature was removed, so its three
        // legislation document categories — FPPR s.14(4), FRPA
        // s.196(1), and FRPA s.196(2) — must not appear in the
        // Add-Attachment dropdown. The DB code-list table is global
        // (and not editable here), so the three codes are filtered
        // out at this service layer.
        .filter(o -> !IDENTIFIED_AREA_ATTACHMENT_TYPE_CODES.contains(o.getCode()))
        .toList();
  }

  /**
   * Attachment-type codes tied to the removed identified-areas feature
   * (FPPR s.14(4), FRPA s.196(1), FRPA s.196(2)). Excluded from the
   * Add-Attachment category dropdown. Values mirror the
   * {@code FSP_ATTACHMENT_TYPE_CODE} codes used in
   * {@code AttachmentsService}.
   */
  private static final java.util.Set<String> IDENTIFIED_AREA_ATTACHMENT_TYPE_CODES =
      java.util.Set.of("FPPR14(4)", "FRPA196(1)", "FRPA196(2)");

  /**
   * Silviculture tree species codes (SILV_TREE_SPECIES_CODE table).
   * Backs the Standards View → Layers species dropdown (preferred +
   * acceptable lists). Cursor exposes code + description columns.
   */
  public List<CodeOption> getSilvTreeSpeciesCodes() {
    return fspCodeListsDao.getSilvTreeSpCd().stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        .toList();
  }

  /**
   * Silviculture statute codes (THE.SILV_STATUTE_CODE table) — the
   * "Regulation" dropdown on the FSP550 Stocking Standards Proposal
   * page. Same shape the legacy code-list loader used
   * (FSP_CODE_LISTS.get_statute_cd), so the FSP can be created with
   * any value the DBA has provisioned without hard-coding the list
   * in the SPA.
   */
  public List<CodeOption> getStatuteCodes() {
    return fspCodeListsDao.getStatuteCd().stream()
        .map(CodeListsService::toCodeOption)
        .filter(o -> o.getCode() != null)
        .toList();
  }

  private static CodeOption toCodeOption(Map<String, Object> row) {
    // First try named lookup (works when the cursor SQL explicitly
    // aliases columns). Fall back to positional: the legacy webADE
    // CodeBeanJDBCAdaptor / ExtCodeBeanJDBCAdaptor both read column 1
    // as code and column 2 as description regardless of name, which
    // is why neither of them was using getString(name). LinkedHashMap
    // in FspCodeListsDaoImpl preserves column order so values() are
    // in DB-cursor order.
    String code = firstNonBlank(row, CODE_KEYS);
    String description = firstNonBlank(row, DESC_KEYS);

    if (code == null || description == null) {
      List<Object> ordered = List.copyOf(row.values());
      if (code == null && !ordered.isEmpty()) {
        code = blankToNull(ordered.get(0));
      }
      if (description == null && ordered.size() >= 2) {
        description = blankToNull(ordered.get(1));
      }
    }

    return CodeOption.builder()
        .code(code)
        .description(description != null ? description : code)
        .build();
  }

  private static String firstNonBlank(Map<String, Object> row, String... keys) {
    for (String key : keys) {
      String s = blankToNull(row.get(key));
      if (s != null) return s;
    }
    return null;
  }

  private static String blankToNull(Object value) {
    if (value == null) return null;
    String s = value.toString().trim();
    return s.isEmpty() ? null : s;
  }
}
