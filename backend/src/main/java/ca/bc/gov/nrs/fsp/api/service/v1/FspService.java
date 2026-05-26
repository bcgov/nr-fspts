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

import java.util.List;

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

  public PageableResponse<FspSearchResult> search(FspSearchRequest request) {
    // P_ENTRY_USER_ROLE — legacy handleGet pulled User.getUser_roles()
    // which returned a space-separated list. The MAINLINE proc uses it
    // to scope visible rows (admin/decision-maker see everything,
    // view-only gates to APP, etc.). Map our canonical FSPTS_* roles
    // onto the legacy FSP_* names the proc expects.
    String userRoles = currentUserLegacyRoles();
    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();

    // Only drain what we need for the current page, plus one extra row
    // to detect whether a next page exists (PageableResponse.ofProbedPage
    // unpacks that signal). Bounded cursor read replaces the previous
    // drain-everything-then-sort pattern; org units with thousands of
    // matching FSPs were taking ~3 minutes over VPN just to drain their
    // REF CURSOR. The proc returns rows in its natural order — legacy's
    // fsp100Search.jsp also iterated in cursor order and never sorted,
    // so we lose nothing dropping the in-memory sort.
    int maxRows = (page + 1) * size + 1;

    // Temporary diagnostic — compare against the legacy proc inputs
    // to confirm we're not sending a role/user that the proc treats
    // differently. Dumps every claim on the current JWT that looks like
    // it could carry the IDIR username (legacy passed `MARCOV`-style
    // IDs, we currently send the Cognito synthetic `dev-idir_<sub>@idir`
    // which won't match any FSP_USER row). Remove once the
    // org-unit-1908 slowness is root-caused.
    var jwt = RequestUtil.getCurrentJwt();
    log.info("FSP_100_SEARCH inputs: orgUnitNo={}, fspId={}, fspStatusCode={}, "
            + "userId={}, userRoles=[{}], maxRows={}",
        nz(request.getOrgUnitNo()), nz(request.getFspId()), nz(request.getFspStatusCode()),
        nz(RequestUtil.getCurrentUserName()), userRoles, maxRows);
    log.info("JWT identity claims — username={}, cognito:username={}, preferred_username={}, "
            + "custom:idp_username={}, custom:idir_username={}, custom:idp_name={}, "
            + "email={}, sub={}, identities={}",
        jwt.getClaimAsString("username"),
        jwt.getClaimAsString("cognito:username"),
        jwt.getClaimAsString("preferred_username"),
        jwt.getClaimAsString("custom:idp_username"),
        jwt.getClaimAsString("custom:idir_username"),
        jwt.getClaimAsString("custom:idp_name"),
        jwt.getClaimAsString("email"),
        jwt.getSubject(),
        jwt.getClaim("identities"));

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
        nz(request.getApprovalRequired()),
        maxRows
    );

    List<FspSearchResult> probed = result.rows().stream()
        .map(FspService::toSearchDto)
        .toList();
    return PageableResponse.ofProbedPage(probed, page, size);
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
