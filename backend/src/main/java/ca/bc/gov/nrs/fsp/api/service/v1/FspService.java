package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Search via FSP_100_SEARCH.MAINLINE; fetch + update via fsp_300_information.MAINLINE.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FspService {

  // FSP_100_SEARCH.MAINLINE dispatches on P_ACTION. The legacy
  // Fsp100SearchAction.handleGet() passes "GET" — not the "FETCH" we
  // were sending. With the wrong action the proc executes a different
  // (or no-op) branch and the cursor comes back empty, which is the
  // "0 results" symptom regardless of the search criteria.
  private static final String ACTION_GET = "GET";
  private static final String ACTION_FETCH = "FETCH";
  private static final String ACTION_UPDATE = "UPDATE";

  private final Fsp100SearchDao searchDao;
  private final Fsp300InformationDao informationDao;

  // Allow-listed sort keys. Maps the JSON field name the front-end sends
  // (sortBy) onto a Comparator over FspSearchResult. Kept narrow so
  // arbitrary input can't trigger a NullPointerException or sort by a
  // field the client wasn't supposed to know about. Any unknown sortBy
  // falls back to fspId.
  private static final Map<String, Function<FspSearchResult, String>> SORT_KEYS = Map.of(
      "fspId", FspSearchResult::getFspId,
      "planName", FspSearchResult::getPlanName,
      "fspAmendmentNumber", FspSearchResult::getFspAmendmentNumber,
      "fspAmendmentName", FspSearchResult::getFspAmendmentName,
      "orgUnitCode", FspSearchResult::getOrgUnitCode,
      "planStartDate", FspSearchResult::getPlanStartDate,
      "planEndDate", FspSearchResult::getPlanEndDate,
      "fspStatusDesc", FspSearchResult::getFspStatusDesc,
      "agreementHolder", FspSearchResult::getAgreementHolder
  );

  // Sort keys whose values are NUMBER in the DB but arrive as VARCHAR
  // in the REF CURSOR. Lex compare ranks "9001" > "10000" which is the
  // opposite of user expectation; numeric compare via toLong is right.
  private static final Set<String> NUMERIC_SORT_KEYS = Set.of(
      "fspId", "fspAmendmentNumber"
  );

  public PageableResponse<FspSearchResult> search(FspSearchRequest request) {
    // P_ENTRY_USER_ROLE — legacy handleGet pulled User.getUser_roles()
    // which returned a space-separated list. The MAINLINE proc uses it
    // to scope visible rows (admin/decision-maker see everything,
    // view-only gates to APP, etc.). Map our canonical FSPTS_* roles
    // onto the legacy FSP_* names the proc expects.
    String userRoles = RequestUtil.getCurrentLegacyRoles();

    // Drain the full cursor with maxRows=0 (unbounded). Matches InboxService:
    // pagination + sort happen in-memory after the read so Carbon's
    // Pagination has an accurate totalElements to compute "page X of Y"
    // from. An earlier bounded-probe variant returned a lower-bound
    // total which made the counter unreliable for the user.
    //
    // Caveat: FSP_100_SEARCH for high-volume org units (e.g. 1908) can
    // take ~3 minutes server-side because the proc's first row is slow
    // regardless of read size; the bounded probe didn't actually help.
    // Real fix lives DB-side (plan / RLS / proxy-user issue, see the
    // search-perf-investigation memory note).
    Fsp100SearchDao.Result result = searchDao.mainline(
        ACTION_GET,
        nz(request.getFspId()),
        nz(request.getFspPlanName()),
        nz(request.getOrgUnitNo()),
        nz(request.getAhClientNumber()),
        nz(request.getFspAmendmentName()),
        // P_ENTRY_USER_CLIENT_NUMBER — pulled from the FAM role suffix
        // (e.g. FSPTS_ADMINISTRATOR_00012797 → "00012797"). Legacy
        // SilUser populated the same value via setUser_client() from
        // WebADE. Empty for users in unqualified roles.
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentIdir(),
        userRoles,
        nz(request.getFspDateStart()),
        nz(request.getFspDateEnd()),
        nz(request.getFspDateType()),
        nz(request.getFspStatusCode()),
        nz(request.getApprovalRequired()),
        0
    );

    List<FspSearchResult> all = result.rows().stream()
        .map(FspService::toSearchDto)
        .sorted(buildComparator(request.getSortBy(), request.getSortDir()))
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static Comparator<FspSearchResult> buildComparator(String sortBy, String sortDir) {
    String resolved = SORT_KEYS.containsKey(sortBy) ? sortBy : "fspId";
    Function<FspSearchResult, String> extract = SORT_KEYS.get(resolved);
    // nullsLast so rows with a missing value land at the bottom in both
    // directions. NUMERIC_SORT_KEYS routes through Long compare so the
    // fspId / amendmentNumber columns sort numerically; everything else
    // uses caseInsensitiveOrder so mixed-case free-text (planName,
    // agreementHolder) sorts intuitively.
    Comparator<FspSearchResult> asc = NUMERIC_SORT_KEYS.contains(resolved)
        ? Comparator.comparing(extract.andThen(FspService::toLong),
            Comparator.nullsLast(Long::compareTo))
        : Comparator.comparing(extract,
            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER));
    return "asc".equalsIgnoreCase(sortDir) ? asc : asc.reversed();
  }

  /** Lenient String → Long; non-numeric or blank → null (sort tail). */
  private static Long toLong(String s) {
    if (s == null) return null;
    String trimmed = s.trim();
    if (trimmed.isEmpty()) return null;
    try {
      return Long.valueOf(trimmed);
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  // Legacy-role mapping / client-number extraction moved to
  // RequestUtil.getCurrentLegacyRoles + RequestUtil.getCurrentClientNumber
  // so other services (e.g. ExtensionService) can reuse the same
  // FAM-cognito → legacy-proc translation.

  public FspRequest getById(String fspId) {
    return getById(fspId, null);
  }

  /**
   * Reads the FSP information record via FSP_300_INFORMATION.MAINLINE
   * with P_ACTION=GET. {@code amendmentNumber} is optional — the proc
   * returns the latest amendment when blank, otherwise the matching one.
   */
  public FspRequest getById(String fspId, String amendmentNumber) {
    Fsp300InformationDao.Result r = callInformation(ACTION_GET, fspId, amendmentNumber, null);
    return toFspDto(r);
  }

  @Transactional
  public FspRequest update(String fspId, FspRequest request) {
    Fsp300InformationDao.Result r = callInformation(ACTION_UPDATE, fspId, null, request);
    return toFspDto(r);
  }

  private Fsp300InformationDao.Result callInformation(
      String action, String fspId, String amendmentNumber, FspRequest request) {
    // FSP_300_INFORMATION.MAINLINE branches on the audit user context
    // when scoping editable fields; the read path needs userId + the
    // mapped legacy role string just as much as update does. When the
    // caller didn't supply them in the request body, fall back to the
    // current JWT.
    //
    // Use the short IDIR (MAVILLEN-style), NOT the composite Cognito
    // username — the proc joins the value into a users table (the
    // legacy Fsp300InformationAction passes formBean.getUser().getName()
    // which is the short form). With the 46-char Cognito composite the
    // proc finds no matching row and falls through to no_access_right
    // even when the user has FSP_ADMINISTRATOR.
    String userId = RequestUtil.getCurrentIdir();
    String userRoles = request != null && request.getUserRole() != null
        ? request.getUserRole()
        : RequestUtil.getCurrentLegacyRoles();
    String userClientNumber = request != null && request.getUserClientNumber() != null
        ? request.getUserClientNumber()
        : RequestUtil.getCurrentClientNumber();
    String resolvedAmendmentNumber = amendmentNumber != null
        ? amendmentNumber
        : (request == null ? "" : nz(request.getFspAmendmentNumber()));
    // The legacy Fsp300InformationAction routes the requested FSP id +
    // amendment number through the P_NEW_* positions on GET (the proc
    // reads from P_NEW_FSP_ID / P_NEW_FSP_AMENDMENT_NUMBER and writes
    // the resolved values back into P_FSP_ID / P_FSP_AMENDMENT_NUMBER).
    // P_FSP_ID stays blank on GET; otherwise the proc treats the call
    // as "look up an existing record by primary key" and returns
    // noRecordsFound for unsaved/draft amendments. UPDATE keeps the
    // post-fetch convention with the id in P_FSP_ID.
    boolean isGet = ACTION_GET.equals(action);
    String inFspId = isGet ? "" : fspId;
    String inNewFspId = isGet ? fspId : "";
    // On GET, send the amendment number as blank so fsp_tombstone.get
    // enters its "find latest accessible amendment" branch — the proc
    // body OR-condition is `(p_fsp_id <> p_new_fsp_id) OR
    // (p_new_fsp_amendment_number IS NULL)`. Sending a concrete value
    // (even '0') drops us into the strict-key path which returns
    // no_access_right when that exact (fsp, amendment) row doesn't
    // exist — even if the user has FSP_ADMINISTRATOR. The legacy form
    // bean defaults this field to "" which Oracle treats as NULL,
    // hitting the "find latest" branch every time.
    String inAmendment = isGet ? "" : resolvedAmendmentNumber;
    String inNewAmendment = isGet ? "" : resolvedAmendmentNumber;
    return informationDao.mainline(
        action,
        inFspId,
        inNewFspId,
        request == null ? "" : nz(request.getFspPlanName()),
        // Legacy Fsp300InformationBean initialises the three VARRAY
        // fields as empty (`new FspOrgUnitVArray()`), not null. Oracle
        // PL/SQL treats NULL collections differently from empty ones —
        // some IS NULL checks in the proc trip and short-circuit to
        // no_access_right. Bind empty lists so the wire shape matches
        // legacy byte-for-byte.
        List.of(),  // P_FSP_ORG_UNITS
        request == null ? "" : nz(request.getFspStatusCode()),
        request == null ? "" : nz(request.getFspStatusDesc()),
        inAmendment,
        inNewAmendment,
        userClientNumber,
        userRoles,
        request == null ? "" : nz(request.getSubmissionId()),
        request == null ? "" : nz(request.getFspExpiryDate()),
        request == null ? "" : nz(request.getAmendmentName()),
        request == null ? "" : nz(request.getAmendmentEfftvDate()),
        "",   // P_NEW_FSP_PLAN_NAME
        "",   // P_NEW_AMENDMENT_NAME
        request == null ? "" : nz(request.getFspPlanStartDate()),
        request == null ? "" : nz(request.getFspPlanTermYears()),
        request == null ? "" : nz(request.getFspPlanTermMonths()),
        request == null ? "" : nz(request.getFspPlanEndDate()),
        request == null ? "" : nz(request.getFspPlanSubmissionDate()),
        request == null ? "" : nz(request.getFspContactName()),
        request == null ? "" : nz(request.getFspTelephoneNumber()),
        request == null ? "" : nz(request.getFspEmailAddress()),
        request == null ? "" : nz(request.getFduUpdateInd()),
        request == null ? "" : nz(request.getIdentifiedAreasUpdateInd()),
        request == null ? "" : nz(request.getStockingStandardUpdateInd()),
        request == null ? "" : nz(request.getApprovalRequiredInd()),
        request == null ? "" : nz(request.getTransitionInd()),
        request == null ? "" : nz(request.getFrpa197electionInd()),
        request == null ? "" : nz(request.getAmendmentAuthority()),
        List.of(), // P_FSP_LICENSES — see above: empty != NULL for the proc
        List.of(), // P_ORG_UNITS
        "",   // P_FSP_STATUS
        // P_ENTRY_USERID — legacy Fsp300InformationAction.handleGet
        // does NOT set this; the form bean's default of "" carries
        // through. The proc treats it as "the user who created the row"
        // and (when populated) joins it against the FSP's audit row
        // looking for a match. Sending the current user's IDIR makes
        // that join fail for any FSP not entered by them and the proc
        // returns no_access_right. Only P_UPDATE_USERID is the current
        // actor on the read path.
        "",
        request == null ? "" : nz(request.getAmendmentReason()),
        request == null ? "" : nz(request.getFspRejectedByEsfInd()),
        request == null ? "" : nz(request.getFspUnapprovedAmendsInd()),
        request == null ? "" : nz(request.getFspExtensionStat()),
        request == null ? "" : nz(request.getFspAmendmentCode()),
        request == null ? "" : nz(request.getFspAmendmentDesc()),
        "",   // P_IS_EXPIRY_CHANGED
        request == null ? "" : nz(request.getRevisionCount()),
        userId  // P_UPDATE_USERID
    );
  }

  private static FspSearchResult toSearchDto(Fsp100SearchDao.Row row) {
    return FspSearchResult.builder()
        .fspId(row.fspId())
        .planName(row.planName())
        .fspAmendmentName(row.fspAmendmentName())
        .orgUnitCode(row.orgUnitCode())
        .planStartDate(row.planStartDate())
        .planEndDate(row.planEndDate())
        .fspAmendmentNumber(row.fspAmendmentNumber())
        .agreementHolder(row.agreementHolder())
        .amendmentApprovalRequirdInd(row.amendmentApprovalRequirdInd())
        .fspStatusDesc(row.fspStatusDesc())
        .build();
  }

  private static FspRequest toFspDto(Fsp300InformationDao.Result r) {
    return FspRequest.builder()
        .fspId(r.pFspId())
        .newFspId(r.pNewFspId())
        .fspPlanName(r.pFspPlanName())
        .fspStatusCode(r.pFspStatusCode())
        .fspStatusDesc(r.pFspStatusDesc())
        .fspAmendmentNumber(r.pFspAmendmentNumber())
        .newFspAmendmentNumber(r.pNewFspAmendmentNumber())
        .userClientNumber(r.pUserClientNumber())
        .userRole(r.pUserRole())
        .submissionId(r.pSubmissionId())
        .fspExpiryDate(r.pFspExpiryDate())
        .amendmentName(r.pAmendmentName())
        .amendmentEfftvDate(r.pAmendmentEfftvDate())
        .fspPlanStartDate(r.pFspPlanStartDate())
        .fspPlanTermYears(r.pFspPlanTermYears())
        .fspPlanTermMonths(r.pFspPlanTermMonths())
        .fspPlanEndDate(r.pFspPlanEndDate())
        .fspPlanSubmissionDate(r.pFspPlanSubmissionDate())
        .fspContactName(r.pFspContactName())
        .fspTelephoneNumber(r.pFspTelephoneNumber())
        .fspEmailAddress(r.pFspEmailAddress())
        .fduUpdateInd(r.pFduUpdateInd())
        .identifiedAreasUpdateInd(r.pIdentifiedAreasUpdateInd())
        .stockingStandardUpdateInd(r.pStockingStandardUpdateInd())
        .approvalRequiredInd(r.pApprovalRequiredInd())
        .transitionInd(r.pTransitionInd())
        .frpa197electionInd(r.pFrpa197electionInd())
        .amendmentAuthority(r.pAmendmentAuthority())
        .amendmentReason(r.pAmendmentReason())
        .fspRejectedByEsfInd(r.pFspRejectedByEsfInd())
        .fspUnapprovedAmendsInd(r.pFspUnapprovedAmendsInd())
        .fspExtensionStat(r.pFspExtensionStat())
        .fspAmendmentCode(r.pFspAmendmentCode())
        .fspAmendmentDesc(r.pFspAmendmentDesc())
        .revisionCount(r.pRevisionCount())
        .agreementHolders(r.pFspLicenses() == null ? List.of()
            : r.pFspLicenses().stream()
                .map(l -> new FspRequest.AgreementHolder(
                    l.clientNumber(), l.clientName(), l.agreementDescription()))
                .toList())
        .districts(r.pOrgUnits() == null ? List.of()
            : r.pOrgUnits().stream()
                .map(o -> new FspRequest.District(
                    o.orgUnitNo(), o.orgUnitCode(), o.orgUnitName()))
                .toList())
        .build();
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
