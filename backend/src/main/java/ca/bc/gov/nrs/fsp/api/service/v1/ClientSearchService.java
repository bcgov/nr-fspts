package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Sil21ClientSearchDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Pages over the full PKG_SIL21_CLIENT_SEARCH cursor result. The proc
 * already ORDER BYs client_name, legal_first_name, legal_middle_name,
 * client_locn_code so we don't re-sort in Java — that order matches
 * what the legacy SIL21 form shipped to users.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClientSearchService {

  private final Sil21ClientSearchDao clientSearchDao;

  public PageableResponse<ClientSearchResult> search(ClientSearchRequest request) {
    List<ClientSearchResult> all = clientSearchDao.getClientSearch(
            request.getClientNumber(),
            request.getClientAcronym(),
            request.getClientName(),
            request.getLegalFirstName(),
            request.getLegalMiddleName())
        .stream()
        .map(ClientSearchService::toDto)
        .toList();

    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();
    return PageableResponse.of(all, page, size);
  }

  private static ClientSearchResult toDto(Sil21ClientSearchDao.Row row) {
    return ClientSearchResult.builder()
        .clientNumber(row.clientNumber())
        .clientAcronym(row.clientAcronym())
        .displayClientNumber(row.displayClientNumber())
        .clientName(row.clientName())
        .legalFirstName(row.legalFirstName())
        .legalMiddleName(row.legalMiddleName())
        .clientLocnCode(row.clientLocnCode())
        .clientLocnName(row.clientLocnName())
        .city(row.city())
        .clientStatusCode(row.clientStatusCode())
        .build();
  }
}
