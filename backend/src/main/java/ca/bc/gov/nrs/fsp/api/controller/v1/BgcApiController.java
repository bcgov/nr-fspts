package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.endpoint.v1.BgcApiEndpoint;
import ca.bc.gov.nrs.fsp.api.service.v1.BgcSearchService;
import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@Slf4j
public class BgcApiController implements BgcApiEndpoint {

  private final BgcSearchService bgcSearchService;

  @Override
  public ResponseEntity<PageableResponse<BgcSearchResult>> searchBgcZones(BgcSearchRequest request) {
    return ResponseEntity.ok(bgcSearchService.search(request));
  }
}
