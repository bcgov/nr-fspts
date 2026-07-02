package ca.bc.gov.nrs.fsp.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.net.URI;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

/**
 * Client for <b>nr-user-lookup-api</b> — the shared BC Gov service that
 * resolves IDIR and BCeID identities (replaces the FAM identity-lookup
 * integration FSP used previously).
 *
 * <p>Base path {@code /api/v1/user-lookup}. Every call carries a
 * Keycloak {@code client_credentials} bearer token minted from FSP's own
 * service account (see {@link ClientCredentialsTokenSource}); the caller's
 * Cognito JWT is <b>not</b> forwarded — nr-user-lookup-api only accepts
 * the service-account token whose default client scopes it validates.
 *
 * <h3>Configuration</h3>
 * <ul>
 *   <li>{@code fsp.user-lookup.base-url} — scheme + host of the API</li>
 *   <li>{@code fsp.user-lookup.token-url} — Keycloak token endpoint</li>
 *   <li>{@code fsp.user-lookup.client-id} / {@code .client-secret} —
 *       FSP's confidential service-account credentials</li>
 *   <li>{@code fsp.user-lookup.scope} — optional; the scopes are DEFAULT
 *       client scopes on the service account, so normally left blank</li>
 * </ul>
 */
@Component
public class UserLookupClient {

  private static final Logger LOG = LoggerFactory.getLogger(UserLookupClient.class);

  private static final String BASE_PATH = "/api/v1/user-lookup";
  private static final String IDIR_DETAIL_PATH = BASE_PATH + "/idir-account-detail";
  private static final String IDIR_SEARCH_PATH = BASE_PATH + "/idir-users/search";
  private static final String BUSINESS_BCEID_PATH = BASE_PATH + "/businessBceid";

  private final RestClient http;
  private final ClientCredentialsTokenSource clientCredentials;

  public UserLookupClient(
      @Value("${fsp.user-lookup.base-url:}") String baseUrl,
      @Value("${fsp.user-lookup.token-url:}") String tokenUrl,
      @Value("${fsp.user-lookup.client-id:}") String clientId,
      @Value("${fsp.user-lookup.client-secret:}") String clientSecret,
      @Value("${fsp.user-lookup.scope:}") String scope,
      @Value("${fsp.user-lookup.connect-timeout:5s}") Duration connectTimeout,
      @Value("${fsp.user-lookup.read-timeout:10s}") Duration readTimeout) {
    this.clientCredentials = ClientCredentialsTokenSource.fromProps(
        tokenUrl, clientId, clientSecret, scope, connectTimeout, readTimeout);

    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
    factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));
    this.http = RestClient.builder()
        .baseUrl(baseUrl == null ? "" : baseUrl)
        .requestFactory(factory)
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();

    if (this.clientCredentials != null) {
      LOG.info(
          "user-lookup client active (OAuth2 client_credentials — base-url={}, "
              + "token-url={}, client-id={}{}",
          baseUrl,
          this.clientCredentials.tokenUrl(),
          this.clientCredentials.clientId(),
          this.clientCredentials.scope().isBlank()
              ? ")"
              : ", scope=" + this.clientCredentials.scope() + ")");
    } else {
      LOG.info(
          "user-lookup client active (no client_credentials auth configured — "
              + "calls will be unauthenticated; set "
              + "USER_LOOKUP_TOKEN_URL/CLIENT_ID/CLIENT_SECRET to enable)");
    }
  }

  /** Test hook: inject a pre-built {@link RestClient} (e.g. bound to a
   *  MockRestServiceServer) and skip client_credentials auth. */
  UserLookupClient(RestClient http) {
    this.http = http;
    this.clientCredentials = null;
  }

  /**
   * Partial-match IDIR user search. Sends only the non-blank criteria as
   * query params to {@code POST /idir-users/search}. Returns an empty
   * list when nothing matches (or on any upstream error — callers treat
   * lookups as best-effort).
   */
  public List<IdirUser> searchIdir(String userId, String firstName, String lastName) {
    String u = normalize(userId);
    String f = normalize(firstName);
    String l = normalize(lastName);
    SearchIdirUsersResponse resp = http.post()
        .uri(uriBuilder -> {
          uriBuilder.path(IDIR_SEARCH_PATH);
          if (u != null) {
            uriBuilder.queryParam("userId", u);
          }
          if (f != null) {
            uriBuilder.queryParam("firstName", f);
          }
          if (l != null) {
            uriBuilder.queryParam("lastName", l);
          }
          URI uri = uriBuilder.build();
          LOG.debug("user-lookup idir search: {}", uri);
          return uri;
        })
        .headers(this::applyAuth)
        .retrieve()
        .body(SearchIdirUsersResponse.class);
    if (resp == null || resp.items() == null) {
      return List.of();
    }
    return resp.items();
  }

  /**
   * Exact IDIR match by user id via {@code GET /idir-account-detail}.
   * Returns {@link Optional#empty()} when the API reports
   * {@code found=false}.
   */
  public Optional<IdirUser> getIdirDetail(String userId) {
    String u = normalize(userId);
    if (u == null) {
      return Optional.empty();
    }
    IdirUserResponse resp = http.get()
        .uri(uriBuilder -> {
          URI uri = uriBuilder.path(IDIR_DETAIL_PATH).queryParam("userId", u).build();
          LOG.debug("user-lookup idir detail: {}", uri);
          return uri;
        })
        .headers(this::applyAuth)
        .retrieve()
        .body(IdirUserResponse.class);
    if (resp == null || !resp.found()) {
      return Optional.empty();
    }
    return Optional.of(new IdirUser(
        resp.userId(), resp.guid(), resp.firstName(), resp.lastName(), resp.email()));
  }

  /**
   * Business BCeID lookup via {@code GET /businessBceid}. {@code searchBy}
   * selects whether {@code searchValue} is a user id or user GUID.
   * Returns {@link Optional#empty()} when {@code found=false}.
   *
   * <p>Provided for completeness of the nr-user-lookup-api contract;
   * FSP has no in-tree caller yet.
   */
  public Optional<BceidUser> getBusinessBceid(SearchBy searchBy, String searchValue) {
    String v = normalize(searchValue);
    if (searchBy == null || v == null) {
      return Optional.empty();
    }
    BceidUser resp = http.get()
        .uri(uriBuilder -> {
          URI uri = uriBuilder.path(BUSINESS_BCEID_PATH)
              .queryParam("searchUserBy", searchBy.wireValue())
              .queryParam("searchValue", v)
              .build();
          LOG.debug("user-lookup business bceid: {}", uri);
          return uri;
        })
        .headers(this::applyAuth)
        .retrieve()
        .body(BceidUser.class);
    if (resp == null || !resp.found()) {
      return Optional.empty();
    }
    return Optional.of(resp);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private void applyAuth(HttpHeaders headers) {
    if (clientCredentials == null) {
      return;
    }
    String token = clientCredentials.fetchCached();
    if (!token.isBlank()) {
      headers.set(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }
  }

  private static String normalize(String v) {
    if (!StringUtils.hasText(v)) {
      return null;
    }
    String t = v.trim();
    return t.isEmpty() ? null : t;
  }

  /** Selector for {@link #getBusinessBceid}; serializes to the API's wire form. */
  public enum SearchBy {
    userId("userId"),
    userGuid("userGuid");

    private final String wireValue;

    SearchBy(String wireValue) {
      this.wireValue = wireValue;
    }

    public String wireValue() {
      return wireValue;
    }
  }

  // ── Local response records (do not leak the API's DTO types) ───────

  /** An IDIR user as returned by search + account-detail. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record IdirUser(
      String userId, String guid, String firstName, String lastName, String email) {}

  /** A business BCeID user as returned by {@code GET /businessBceid}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record BceidUser(
      boolean found,
      String userId,
      String guid,
      String businessGuid,
      String businessLegalName,
      String firstName,
      String lastName,
      String email) {}

  /** Wire shape of {@code GET /idir-account-detail}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  private record IdirUserResponse(
      boolean found,
      String userId,
      String guid,
      String firstName,
      String lastName,
      String email) {}

  /** Wire shape of {@code POST /idir-users/search}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  private record SearchIdirUsersResponse(int totalItems, int pageSize, List<IdirUser> items) {
    SearchIdirUsersResponse {
      if (items == null) {
        items = Collections.emptyList();
      }
    }
  }
}
