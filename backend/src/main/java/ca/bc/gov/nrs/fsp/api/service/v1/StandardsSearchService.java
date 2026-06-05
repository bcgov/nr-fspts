package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardsSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardsSearchResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Wraps {@link Fsp501StdsSrchDao} for the FSP501 "Standards Search"
 * page. Drains the full cursor and paginates/sorts in memory (same
 * pattern as {@link FspService#search}) so the UI's Carbon Pagination
 * widget has an accurate totalElements count.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StandardsSearchService {

  // Legacy proc dispatches reads on P_ACTION = "GET" (same convention
  // as FSP_100_SEARCH / FSP_300_INFORMATION / FSP_500_STOCKING_STANDARDS).
  private static final String ACTION_GET = "GET";

  private static final Map<String, Function<StandardsSearchResult, String>> SORT_KEYS = Map.of(
      "standardsRegimeId", StandardsSearchResult::getStandardsRegimeId,
      "standardsRegimeName", StandardsSearchResult::getStandardsRegimeName,
      "standardsObjective", StandardsSearchResult::getStandardsObjective,
      "bgc", StandardsSearchResult::getBgc,
      "clientNumber", StandardsSearchResult::getClientNumber,
      "status", StandardsSearchResult::getStatus,
      "expiryDate", StandardsSearchResult::getExpiryDate,
      "fspIdList", StandardsSearchResult::getFspIdList
  );

  /** Sort keys whose cursor values are NUMBER on the DB but VARCHAR on the wire. */
  private static final Set<String> NUMERIC_SORT_KEYS = Set.of(
      "standardsRegimeId"
  );

  private final Fsp501StdsSrchDao searchDao;

  public PageableResponse<StandardsSearchResult> search(StandardsSearchRequest request) {
    Fsp501StdsSrchDao.Result result = searchDao.mainline(
        ACTION_GET,
        nz(request.getDefaultStandard()),
        nz(request.getStandardsRegimeStatusCode()),
        nz(request.getOrgUnitNo()),
        nz(request.getFspId()),
        nz(request.getClientNumber()),
        nz(request.getClientName()),
        nz(request.getStandardsRegimeId()),
        nz(request.getStandardsRegimeName()),
        nz(request.getStandardsObjective()),
        nz(request.getPreferredSpecies()),
        nz(request.getAcceptableSpecies()),
        nz(request.getExpiryDateFrom()),
        nz(request.getExpiryDateTo()),
        nz(request.getBgcZoneCode()),
        nz(request.getBgcSubzoneCode()),
        nz(request.getBgcVariant()),
        nz(request.getBgcPhase()),
        nz(request.getBecSiteSeriesCd()),
        nz(request.getBecSiteSeriesPhaseCd()),
        nz(request.getBecSeral()),
        0  // unbounded — same pagination strategy as FspService.search
    );

    List<StandardsSearchResult> all = result.rows().stream()
        .map(StandardsSearchService::toDto)
        .sorted(buildComparator(request.getSortBy(), request.getSortDir()))
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static StandardsSearchResult toDto(Fsp501StdsSrchDao.Row r) {
    return StandardsSearchResult.builder()
        .standardsRegimeId(r.standardsRegimeId())
        .standardsRegimeName(r.standardsRegimeName())
        .standardsObjective(r.standardsObjective())
        .bgc(r.bgc())
        .clientNumber(r.clientNumber())
        .status(r.status())
        .expiryDate(r.expiryDate())
        .fspIdList(r.fspIdList())
        .build();
  }

  private static Comparator<StandardsSearchResult> buildComparator(String sortBy, String sortDir) {
    String resolved = SORT_KEYS.containsKey(sortBy) ? sortBy : "standardsRegimeId";
    Function<StandardsSearchResult, String> extract = SORT_KEYS.get(resolved);
    Comparator<StandardsSearchResult> asc = NUMERIC_SORT_KEYS.contains(resolved)
        ? Comparator.comparing(extract.andThen(StandardsSearchService::toLong),
            Comparator.nullsLast(Long::compareTo))
        : Comparator.comparing(extract,
            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER));
    return "desc".equalsIgnoreCase(sortDir) ? asc.reversed() : asc;
  }

  private static Long toLong(String s) {
    if (s == null) return null;
    String t = s.trim();
    if (t.isEmpty()) return null;
    try {
      return Long.valueOf(t);
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
