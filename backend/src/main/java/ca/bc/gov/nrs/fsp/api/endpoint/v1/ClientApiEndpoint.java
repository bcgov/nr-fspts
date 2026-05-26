package ca.bc.gov.nrs.fsp.api.endpoint.v1;

import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Client lookup endpoints. Lives under /api/v1/clients (not /api/v1/fsp)
 * because client search is a generic resource — any FSP screen that
 * needs an agreement-holder / contact / submitter picker hits this.
 *
 * Auth is the same Cognito JWT validation the FSP endpoints use; see
 * FspSecurityConfig (path-agnostic resource-server config).
 */
@RequestMapping("/api/v1/clients")
@Tag(name = "Client API", description = "Client lookup operations")
public interface ClientApiEndpoint {

  @GetMapping("/search")
  @Operation(summary = "Search clients via PKG_SIL21_CLIENT_SEARCH.get_client_search (paginated in-memory)")
  ResponseEntity<PageableResponse<ClientSearchResult>> searchClients(@Valid ClientSearchRequest request);
}
