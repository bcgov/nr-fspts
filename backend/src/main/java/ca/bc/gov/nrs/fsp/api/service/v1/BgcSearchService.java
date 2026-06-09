package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Sil52BgcSearchDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Pages over the full {@code SIL_52_BGC_SEARCH_V003.MAINLINE(GET)}
 * cursor. The proc already orders rows by zone/subzone/variant/phase/
 * site_series/site_series_phase/seral, so we preserve that order rather
 * than re-sorting in Java.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class BgcSearchService {

  private final Sil52BgcSearchDao bgcSearchDao;

  public PageableResponse<BgcSearchResult> search(BgcSearchRequest request) {
    List<BgcSearchResult> all = bgcSearchDao.getBgcSearch(
            request.getBgcZoneCode(),
            request.getBgcSubzoneCode(),
            request.getBgcVariant(),
            request.getBgcPhase(),
            request.getBecSiteSeriesCd(),
            request.getBecSiteSeriesPhaseCd(),
            request.getBecSeral())
        .stream()
        .map(BgcSearchService::toDto)
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static BgcSearchResult toDto(Sil52BgcSearchDao.Row row) {
    return BgcSearchResult.builder()
        .bgcZoneCode(row.bgcZoneCode())
        .bgcSubzoneCode(row.bgcSubzoneCode())
        .bgcVariant(row.bgcVariant())
        .bgcPhase(row.bgcPhase())
        .becSiteSeriesCd(row.becSiteSeriesCd())
        .becSiteSeriesPhaseCd(row.becSiteSeriesPhaseCd())
        .becSeral(row.becSeral())
        .siteSeriesDesc(row.siteSeriesDesc())
        .build();
  }
}
