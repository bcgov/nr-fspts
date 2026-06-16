package ca.bc.gov.nrs.fsp.api.notification;

import java.net.URI;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * {@link DesignateEmailResolver} backed by the FAM identity-lookup API
 * — same endpoint {@link ca.bc.gov.nrs.fsp.api.service.v1.UserDirectoryService}
 * uses for the in-request user picker. Lives in the notification
 * package (not under {@code service.v1}) because it must NOT pull the
 * caller's JWT from the security context: the designate batch runs on
 * a scheduler thread where there is no security context.
 *
 * <p>Authentication strategy is intentionally simple:
 * <ul>
 *   <li>If {@code fsp.fam.bearer-token} is non-blank, attach it as
 *       {@code Authorization: Bearer ...}. Use this when FAM admin
 *       provisions a long-lived service token.</li>
 *   <li>Otherwise call without any {@code Authorization} header. Some
 *       FAM deployments expose the IDIR search openly inside the BC
 *       Gov network; if yours doesn't, the resolver logs the 401 once
 *       per designate and skips them so the operator can wire a token.</li>
 * </ul>
 *
 * <p>Active only when {@code fsp.notification.designate.enabled=true}.
 * Otherwise no resolver bean is registered and the digest is off
 * entirely (the scheduler is conditional on the same flag).
 */
@Component
@ConditionalOnProperty(
    prefix = "fsp.notification.designate",
    name = "enabled",
    havingValue = "true")
@Slf4j
public class FamDesignateEmailResolver implements DesignateEmailResolver {

  private static final String SEARCH_PATH = "/external/v1/users/identity/idir/search";

  // FAM rejects pageSize < 10 with HTTP 422 — same constant
  // UserDirectoryService uses.
  private static final int UPSTREAM_PAGE_SIZE = 10;

  private final RestClient http;
  private final String bearerToken;

  public FamDesignateEmailResolver(
      @Value("${ca.bc.gov.nrs.identity-lookup.base-url:}") String baseUrl,
      @Value("${fsp.fam.bearer-token:}") String bearerToken,
      @Value("${ca.bc.gov.nrs.identity-lookup.connect-timeout:5s}") Duration connectTimeout,
      @Value("${ca.bc.gov.nrs.identity-lookup.read-timeout:10s}") Duration readTimeout) {
    if (baseUrl == null || baseUrl.isBlank()) {
      throw new IllegalStateException(
          "fsp.notification.designate.enabled=true but"
              + " ca.bc.gov.nrs.identity-lookup.base-url is blank — set IDENTITY_LOOKUP_BASE_URL");
    }
    this.bearerToken = bearerToken == null ? "" : bearerToken.trim();
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
    factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));
    this.http = RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(factory)
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();
    if (this.bearerToken.isBlank()) {
      log.info(
          "FAM designate-email resolver active (no bearer token configured — "
              + "calls will be unauthenticated; set FSP_FAM_BEARER_TOKEN if FAM requires auth)");
    } else {
      log.info("FAM designate-email resolver active (using configured bearer token)");
    }
  }

  @Override
  public Optional<String> resolveEmail(String designateIdir) {
    if (designateIdir == null || designateIdir.isBlank()) return Optional.empty();
    // The designate table stores the full "IDIR\NAME" form; FAM keys on
    // the bare username. Mirror UserDirectoryService.findByUserId.
    String bare = designateIdir.contains("\\")
        ? designateIdir.substring(designateIdir.indexOf('\\') + 1)
        : designateIdir;

    LookupResponse resp;
    try {
      var request = http.get()
          .uri(uriBuilder -> {
            uriBuilder.path(SEARCH_PATH)
                .queryParam("pageSize", UPSTREAM_PAGE_SIZE)
                .queryParam("userId", bare);
            URI uri = uriBuilder.build();
            log.debug("FAM lookup for designate {}: {}", designateIdir, uri);
            return uri;
          });
      if (!bearerToken.isBlank()) {
        request = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + bearerToken);
      }
      resp = request.retrieve().body(LookupResponse.class);
    } catch (RuntimeException ex) {
      log.warn("FAM lookup failed for designate {} ({})", designateIdir, ex.getMessage());
      return Optional.empty();
    }
    if (resp == null || resp.items() == null) return Optional.empty();
    // FAM may return multiple matches (substring search). Prefer the
    // exact userId match; fall back to first non-null email.
    return resp.items().stream()
        .filter(u -> u != null && bare.equalsIgnoreCase(u.userId()))
        .map(LookupUser::email)
        .filter(e -> e != null && !e.isBlank())
        .findFirst()
        .or(() -> resp.items().stream()
            .filter(u -> u != null && u.email() != null && !u.email().isBlank())
            .map(LookupUser::email)
            .findFirst());
  }

  private record LookupResponse(long totalItems, int pageSize, List<LookupUser> items) {
    LookupResponse {
      if (items == null) items = Collections.emptyList();
    }
  }

  private record LookupUser(String userId, String guid, String firstName, String lastName, String email) {}
}
