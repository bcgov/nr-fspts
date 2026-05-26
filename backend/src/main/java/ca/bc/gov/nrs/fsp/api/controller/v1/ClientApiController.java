package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.endpoint.v1.ClientApiEndpoint;
import ca.bc.gov.nrs.fsp.api.service.v1.ClientSearchService;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@Slf4j
public class ClientApiController implements ClientApiEndpoint {

  private final ClientSearchService clientSearchService;

  @Override
  public ResponseEntity<PageableResponse<ClientSearchResult>> searchClients(ClientSearchRequest request) {
    return ResponseEntity.ok(clientSearchService.search(request));
  }
}
