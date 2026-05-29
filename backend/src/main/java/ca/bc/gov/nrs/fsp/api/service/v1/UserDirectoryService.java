package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.struct.v1.UserSearchResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.UserSummary;

import java.net.URI;
import java.time.Duration;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

/**
 * Searches IDIR users via the FAM identity-lookup API. Port of nr-rept's
 * ReptUserDirectoryService (minus the @Retry annotation — FSP doesn't
 * have resilience4j on the classpath; add it later if flakiness shows).
 *
 * <p>The service passes the caller's Cognito access token through to
 * the downstream API as a Bearer token. No service-account credentials
 * are involved.
 *
 * <h3>Configuration</h3>
 * <ul>
 *   <li>{@code ca.bc.gov.nrs.identity-lookup.base-url} — scheme + host
 *       (resolved from the {@code IDENTITY_LOOKUP_BASE_URL} env var)</li>
 *   <li>{@code ca.bc.gov.nrs.identity-lookup.default-page-size} —
 *       defaults to 50 when the caller doesn't specify</li>
 * </ul>
 */
@Service
public class UserDirectoryService {

  private static final Logger LOG = LoggerFactory.getLogger(UserDirectoryService.class);

  private static final String SEARCH_PATH = "/external/v1/users/identity/idir/search";

  // FAM's identity-lookup API rejects pageSize < 10 with HTTP 422. Callers
  // (e.g. the district-notification enrichment that just wants the first
  // hit) can still request smaller sizes; we clamp the upstream call and
  // slice the response locally.
  private static final int MIN_UPSTREAM_PAGE_SIZE = 10;

  private static final Comparator<UserSummary> USER_COMPARATOR =
      Comparator.comparing(UserSummary::displayName,
              Comparator.nullsLast(String::compareToIgnoreCase))
          .thenComparing(UserSummary::userId,
              Comparator.nullsLast(String::compareToIgnoreCase));

  private final RestClient restClient;
  private final int defaultPageSize;

  public UserDirectoryService(
      @Value("${ca.bc.gov.nrs.identity-lookup.base-url:}") String baseUrl,
      @Value("${ca.bc.gov.nrs.identity-lookup.default-page-size:50}") int defaultPageSize,
      @Value("${ca.bc.gov.nrs.identity-lookup.connect-timeout:5s}") Duration connectTimeout,
      @Value("${ca.bc.gov.nrs.identity-lookup.read-timeout:10s}") Duration readTimeout
  ) {
    this.defaultPageSize = defaultPageSize;

    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
    factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));

    this.restClient = RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(factory)
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();
  }

  /**
   * Searches for IDIR users matching the given criteria. At least one
   * of {@code userId}, {@code firstName}, {@code lastName} must be
   * non-blank.
   */
  public UserSearchResponse searchUsers(
      String userId, String firstName, String lastName, int size) {
    String normUserId = normalize(userId);
    String normFirstName = normalize(firstName);
    String normLastName = normalize(lastName);

    if (!StringUtils.hasText(normUserId)
        && !StringUtils.hasText(normFirstName)
        && !StringUtils.hasText(normLastName)) {
      throw new IllegalArgumentException(
          "Provide at least one search field (user ID, first name, or last name)");
    }

    int requestedSize = size > 0 ? size : defaultPageSize;
    int upstreamPageSize = Math.max(requestedSize, MIN_UPSTREAM_PAGE_SIZE);
    String bearerToken = extractBearerToken();

    IdentityLookupResponse response = restClient.get()
        .uri(uriBuilder -> {
          uriBuilder.path(SEARCH_PATH).queryParam("pageSize", upstreamPageSize);
          if (StringUtils.hasText(normUserId)) uriBuilder.queryParam("userId", normUserId);
          if (StringUtils.hasText(normFirstName)) uriBuilder.queryParam("firstName", normFirstName);
          if (StringUtils.hasText(normLastName)) uriBuilder.queryParam("lastName", normLastName);
          URI uri = uriBuilder.build();
          LOG.debug("Identity-lookup request: {}", uri);
          return uri;
        })
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + bearerToken)
        .retrieve()
        .body(IdentityLookupResponse.class);

    if (response == null) {
      return new UserSearchResponse(List.of(), 0, 0, requestedSize);
    }

    List<UserSummary> results = mapItems(response.items());
    if (results.size() > requestedSize) {
      results = results.subList(0, requestedSize);
    }

    LOG.debug("Identity-lookup search [{} {} {}] returned {} of {} results",
        normUserId, normFirstName, normLastName, results.size(), response.totalItems());

    return new UserSearchResponse(results, response.totalItems(), 0, requestedSize);
  }

  /**
   * Best-effort single-user lookup by IDIR username. Used to enrich
   * district-notification designate rows with display name + email.
   * Returns {@link Optional#empty()} when the user can't be resolved
   * (e.g. lookup API not configured, user not found, or an upstream
   * error) — the caller treats that as "show the IDIR alone".
   */
  public Optional<UserSummary> findByUserId(String userId) {
    if (!StringUtils.hasText(userId)) return Optional.empty();
    // FAM stores IDs as the bare IDIR name (no "IDIR\" prefix); the
    // designate table sometimes carries the full "IDIR\NAME" form, so
    // strip the directory part if present before querying.
    String bare = userId.contains("\\") ? userId.substring(userId.indexOf('\\') + 1) : userId;
    try {
      UserSearchResponse response = searchUsers(bare, null, null, 1);
      return response.results().stream().findFirst();
    } catch (RuntimeException ex) {
      LOG.debug("Identity-lookup miss for userId={} ({})", userId, ex.getMessage());
      return Optional.empty();
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private String extractBearerToken() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication instanceof JwtAuthenticationToken jwtAuth) {
      return jwtAuth.getToken().getTokenValue();
    }
    throw new IllegalStateException("No valid JWT bearer token in security context");
  }

  private List<UserSummary> mapItems(List<IdentityLookupUser> items) {
    if (items == null || items.isEmpty()) return List.of();
    return items.stream()
        .filter(Objects::nonNull)
        .map(UserDirectoryService::toSummary)
        .filter(Objects::nonNull)
        .sorted(USER_COMPARATOR)
        .toList();
  }

  private static UserSummary toSummary(IdentityLookupUser user) {
    String userId = trimmed(user.userId());
    if (!StringUtils.hasText(userId)) return null;
    String firstName = trimmed(user.firstName());
    String lastName = trimmed(user.lastName());
    String displayName = buildDisplayName(firstName, lastName, userId);
    return new UserSummary(
        userId, displayName, firstName, lastName,
        trimmed(user.email()), trimmed(user.guid()), null);
  }

  private static String buildDisplayName(String firstName, String lastName, String fallback) {
    if (StringUtils.hasText(firstName) && StringUtils.hasText(lastName)) {
      return firstName + " " + lastName;
    }
    if (StringUtils.hasText(firstName)) return firstName;
    if (StringUtils.hasText(lastName)) return lastName;
    return fallback;
  }

  private static String trimmed(String v) {
    return v == null ? null : v.trim();
  }

  private static String normalize(String v) {
    if (!StringUtils.hasText(v)) return null;
    String t = v.trim();
    return t.isEmpty() ? null : t;
  }

  // Identity-lookup raw response shape — local records so we don't
  // leak FAM JSON keys outside this service.
  private record IdentityLookupResponse(
      long totalItems, int pageSize, List<IdentityLookupUser> items
  ) {
    IdentityLookupResponse {
      if (items == null) items = Collections.emptyList();
    }
  }

  private record IdentityLookupUser(
      String userId, String guid, String firstName, String lastName, String email
  ) {}
}
