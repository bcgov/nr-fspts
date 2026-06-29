package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDirectDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardsSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardsSearchResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * FSP501 "Standards Search". Backed by the direct-table query
 * {@link Fsp501StdsSrchDirectDao} (replaces {@code FSP_501_STDS_SRCH.MAINLINE},
 * whose per-row PL/SQL scalar functions + DISTINCT fan-out made it slow).
 * Pagination, ordering, and the total count are pushed into SQL.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StandardsSearchService {

  private final Fsp501StdsSrchDirectDao directDao;

  public PageableResponse<StandardsSearchResult> search(StandardsSearchRequest request) {
    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();

    var criteria = new Fsp501StdsSrchDirectDao.SearchCriteria(
        nz(request.getDefaultStandard()),
        nz(request.getStandardsRegimeStatusCode()),
        nz(request.getOrgUnitNo()),
        nz(request.getFspId()),
        nz(request.getClientNumber()),
        nz(request.getStandardsRegimeId()),
        nz(request.getStandardsRegimeName()),
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
        nz(request.getBecSeral()));

    Fsp501StdsSrchDirectDao.Page result =
        directDao.searchPage(criteria, page, size, request.getSortBy(), request.getSortDir());
    List<StandardsSearchResult> content = result.rows().stream()
        .map(StandardsSearchService::toDto)
        .toList();
    return PageableResponse.ofPage(content, page, size, result.total());
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

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
