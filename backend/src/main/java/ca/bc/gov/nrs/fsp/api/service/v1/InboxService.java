package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp200InboxDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.InboxRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Wraps fsp_200_inbox.MAINLINE. The legacy FSP200 form scoped to the
 * user's home org_unit via User.getUser_org_unit (a webADE-era session
 * attribute). We don't get that automatically from Cognito — the JWT
 * doesn't carry a custom:org_unit_no claim — so the user picks their
 * district from the front-end dropdown and we forward whatever they
 * chose. Blank orgUnitNo goes to the proc as-is.
 *
 * Pagination + sort are applied in-memory after reading the full
 * cursor — fsp_200_inbox.MAINLINE has no native paging, same as
 * FSP_100_SEARCH.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class InboxService {

  // P_ACTION = "GET". Legacy Fsp200InboxAction.handleGet() explicitly
  // sets this and the package spec header even says "Expected values
  // for input parameters are: P_ACTION: GET". With anything else
  // (incl. the obvious-looking "FETCH") MAINLINE's dispatch branch is
  // a no-op and the cursor comes back empty — exact same trap as
  // FSP_100_SEARCH. Don't change this without re-reading the proc body.
  private static final String ACTION_GET = "GET";

  // Allow-listed sort keys — narrower than FspService.SORT_KEYS because
  // the inbox cursor only populates a subset of FspSearchResult fields
  // (the FSP_100_SEARCH-only ones like orgUnitCode, planStartDate, etc.
  // come back null from fsp_200_inbox). Unknown keys fall back to fspId.
  private static final Map<String, Function<FspSearchResult, String>> SORT_KEYS = Map.of(
      "fspId", FspSearchResult::getFspId,
      "planName", FspSearchResult::getPlanName,
      "fspAmendmentNumber", FspSearchResult::getFspAmendmentNumber,
      "extensionNumber", FspSearchResult::getExtensionNumber,
      "fspStatusDesc", FspSearchResult::getFspStatusDesc,
      "planSubmissionDate", FspSearchResult::getPlanSubmissionDate,
      "updateUserid", FspSearchResult::getUpdateUserid,
      "agreementHolder", FspSearchResult::getAgreementHolder
  );

  // Sort keys whose values are numeric in the DB (NUMBER columns) but
  // arrive as VARCHAR in the REF CURSOR. Lexicographic compare ranks
  // "9001" > "10000" which is the opposite of what users expect when
  // looking at FSP IDs / amendment / extension numbers. Parse to Long
  // and compare numerically for these keys; non-numeric or null values
  // land at the bottom via the nullsLast wrapper.
  private static final Set<String> NUMERIC_SORT_KEYS = Set.of(
      "fspId", "fspAmendmentNumber", "extensionNumber"
  );

  private final Fsp200InboxDao inboxDao;

  public PageableResponse<FspSearchResult> getInbox(InboxRequest request) {
    Fsp200InboxDao.Result result = inboxDao.mainline(
        ACTION_GET,
        nz(request.getOrgUnitNo()),
        nz(request.getFspId()),
        nz(request.getFspPlanName()),
        nz(request.getFspStatusCode()),
        nz(request.getAhClientNumber())
    );

    List<FspSearchResult> all = result.rows().stream()
        .map(InboxService::toDto)
        .sorted(buildComparator(request.getSortBy(), request.getSortDir()))
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static Comparator<FspSearchResult> buildComparator(String sortBy, String sortDir) {
    String resolved = SORT_KEYS.containsKey(sortBy) ? sortBy : "fspId";
    Function<FspSearchResult, String> extract = SORT_KEYS.get(resolved);
    Comparator<FspSearchResult> asc = NUMERIC_SORT_KEYS.contains(resolved)
        ? Comparator.comparing(extract.andThen(InboxService::toLong),
            Comparator.nullsLast(Long::compareTo))
        : Comparator.comparing(extract,
            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER));
    return "asc".equalsIgnoreCase(sortDir) ? asc : asc.reversed();
  }

  /**
   * Lenient String → Long for the numeric-sort path. Returns null for
   * null, blank, or non-numeric input so the nullsLast wrapper parks
   * those rows at the bottom — matches "missing value, push down"
   * intent better than throwing.
   */
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

  private static String nz(String s) {
    return s == null ? "" : s;
  }

  private static FspSearchResult toDto(Fsp200InboxDao.Row row) {
    return FspSearchResult.builder()
        .fspId(row.fspId())
        .planName(row.planName())
        .fspAmendmentNumber(row.fspAmendmentNumber())
        .extensionNumber(row.extensionNumber())
        .updateUserid(row.updateUserid())
        .fspStatusDesc(row.fspStatusDesc())
        .planSubmissionDate(row.planSubmissionDate())
        .agreementHolder(row.agreementHolder())
        .numberOfFdu(row.numberOfFdu())
        .build();
  }
}
