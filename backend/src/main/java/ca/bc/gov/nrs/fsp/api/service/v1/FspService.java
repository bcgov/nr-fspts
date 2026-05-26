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

  public PageableResponse<FspSearchResult> search(FspSearchRequest request) {
    // P_ENTRY_USER_ROLE — legacy handleGet pulled User.getUser_roles()
    // which returned a space-separated list. The MAINLINE proc uses it
    // to scope visible rows (admin/decision-maker see everything,
    // view-only gates to APP, etc.). Map our canonical FSPTS_* roles
    // onto the legacy FSP_* names the proc expects.
    String userRoles = currentUserLegacyRoles();
    Fsp100SearchDao.Result result = searchDao.mainline(
        ACTION_GET,
        nz(request.getFspId()),
        nz(request.getFspPlanName()),
        nz(request.getOrgUnitNo()),
        nz(request.getAhClientNumber()),
        nz(request.getFspAmendmentName()),
        "",   // P_ENTRY_USER_CLIENT_NUMBER — only set for BCeID submitters
        nz(RequestUtil.getCurrentUserName()),
        userRoles,
        nz(request.getFspDateStart()),
        nz(request.getFspDateEnd()),
        nz(request.getFspDateType()),
        nz(request.getFspStatusCode()),
        nz(request.getApprovalRequired())
    );
    // Pull the full cursor (proc has no native paging), sort + slice
    // in-memory. For typical FSP search result counts (<= a few hundred
    // rows) this is fine; if we ever need to scale past that, push the
    // ORDER BY + ROWNUM windowing into a wrapper view around the proc.
    List<FspSearchResult> all = result.rows().stream()
        .map(FspService::toSearchDto)
        .sorted(buildComparator(request.getSortBy(), request.getSortDir()))
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static Comparator<FspSearchResult> buildComparator(String sortBy, String sortDir) {
    Function<FspSearchResult, String> key = SORT_KEYS.getOrDefault(sortBy, FspSearchResult::getFspId);
    // nullsLast so rows with a missing value land at the bottom in both
    // directions; caseInsensitiveOrder so mixed-case values (planName
    // free-text) sort intuitively.
    Comparator<FspSearchResult> asc = Comparator.comparing(
        key, Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER));
    return "asc".equalsIgnoreCase(sortDir) ? asc : asc.reversed();
  }

  /**
   * Map the canonical FSPTS_* roles in the current JWT's cognito:groups
   * claim onto the legacy FSP_* role names FSP_100_SEARCH.MAINLINE
   * expects (FSP_ADMINISTRATOR, FSP_DECISION_MAKER, FSP_REVIEWER,
   * FSP_SUBMITTER, FSP_VIEW_ONLY). Returns a space-separated list so
   * the proc's role-presence checks (StringUtils.contains style) keep
   * working. Org-suffixed groups (FSPTS_ADMINISTRATOR_DPG) are stripped
   * to the canonical root before rewriting FSPTS_ → FSP_.
   */
  private static String currentUserLegacyRoles() {
    var jwt = RequestUtil.getCurrentJwt();
    var groups = jwt.getClaimAsStringList("cognito:groups");
    if (groups == null || groups.isEmpty()) return "";
    String[] canonical = {
        "FSPTS_ADMINISTRATOR", "FSPTS_DECISION_MAKER", "FSPTS_REVIEWER",
        "FSPTS_VIEW_ALL", "FSPTS_SUBMITTER", "FSPTS_VIEW_ONLY",
    };
    return groups.stream()
        .map(g -> {
          for (String role : canonical) {
            if (g.equals(role) || g.startsWith(role + "_")) {
              return role.replaceFirst("^FSPTS_", "FSP_");
            }
          }
          return null;
        })
        .filter(java.util.Objects::nonNull)
        .distinct()
        .collect(java.util.stream.Collectors.joining(" "));
  }

  public FspRequest getById(String fspId) {
    Fsp300InformationDao.Result r = callInformation(ACTION_FETCH, fspId, null);
    return toFspDto(r);
  }

  @Transactional
  public FspRequest update(String fspId, FspRequest request) {
    Fsp300InformationDao.Result r = callInformation(ACTION_UPDATE, fspId, request);
    return toFspDto(r);
  }

  private Fsp300InformationDao.Result callInformation(String action, String fspId, FspRequest request) {
    String userId = RequestUtil.getCurrentUserName();
    return informationDao.mainline(
        action,
        fspId,
        "",   // P_NEW_FSP_ID
        request == null ? "" : nz(request.getFspPlanName()),
        null, // P_FSP_ORG_UNITS — IN-only when not provided by client
        request == null ? "" : nz(request.getFspStatusCode()),
        request == null ? "" : nz(request.getFspStatusDesc()),
        request == null ? "" : nz(request.getFspAmendmentNumber()),
        "",   // P_NEW_FSP_AMENDMENT_NUMBER
        request == null ? "" : nz(request.getUserClientNumber()),
        request == null ? "" : nz(request.getUserRole()),
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
        null, // P_FSP_LICENSES
        null, // P_ORG_UNITS
        "",   // P_FSP_STATUS
        userId,
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
        .build();
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
