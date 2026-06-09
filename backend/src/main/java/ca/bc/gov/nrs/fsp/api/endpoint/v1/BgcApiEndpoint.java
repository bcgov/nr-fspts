package ca.bc.gov.nrs.fsp.api.endpoint.v1;

import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * BGC Zone lookup endpoints. Lives under /api/v1/bgc-zones (not
 * /api/v1/fsp) because BGC search is a generic resource — used today
 * by the FSP250 standards "Add BGC Zone" dialog, and ready for reuse
 * by any future screen that needs the same BEC picker.
 *
 * <p>Auth matches the FSP endpoints (Cognito JWT validation via
 * FspSecurityConfig path-agnostic resource-server config).
 */
@RequestMapping("/api/v1/bgc-zones")
@Tag(name = "BGC Zone API", description = "BGC zone lookup operations")
public interface BgcApiEndpoint {

  @GetMapping("/search")
  @Operation(summary = "Search BGC zones via PKG_SIL52_BGC_SEARCH.get_bgc_search (paginated in-memory)")
  ResponseEntity<PageableResponse<BgcSearchResult>> searchBgcZones(@Valid BgcSearchRequest request);
}
