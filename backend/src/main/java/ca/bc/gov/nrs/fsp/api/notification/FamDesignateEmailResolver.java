package ca.bc.gov.nrs.fsp.api.notification;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
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
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@link DesignateEmailResolver} backed by the FAM identity-lookup API
 * — same endpoint {@link ca.bc.gov.nrs.fsp.api.service.v1.UserDirectoryService}
 * uses for the in-request user picker. Lives in the notification
 * package (not under {@code service.v1}) because it must NOT pull the
 * caller's JWT from the security context: the designate batch runs on
 * a scheduler thread where there is no security context.
 *
 * <p>Authentication strategy:
 * <ul>
 *   <li>If {@code fsp.fam.token-url} + {@code fsp.fam.client-id}
 *       + {@code fsp.fam.client-secret} are all set, exchange the
 *       confidential-client credentials via OAuth2
 *       {@code grant_type=client_credentials} and cache the resulting
 *       access token until ~60s before expiry.</li>
 *   <li>Else call FAM without any {@code Authorization} header.
 *       Some FAM deployments expose the IDIR search openly inside the
 *       BC Gov network; if yours doesn't, the resolver logs the 401
 *       once per designate and skips them.</li>
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
  private final ClientCredentialsTokenSource clientCredentials;
  // Cached client-credentials access token + the moment it expires.
  // Refresh ~60s before expiry to absorb clock skew + token-endpoint
  // latency. volatile because the scheduler thread reads/writes; one
  // batch never fans out concurrent FAM calls so a CAS isn't needed.
  private volatile String cachedAccessToken = "";
  private volatile Instant cachedAccessTokenExpiresAt = Instant.EPOCH;

  public FamDesignateEmailResolver(
      @Value("${ca.bc.gov.nrs.identity-lookup.base-url:}") String baseUrl,
      @Value("${fsp.fam.token-url:}") String tokenUrl,
      @Value("${fsp.fam.client-id:}") String clientId,
      @Value("${fsp.fam.client-secret:}") String clientSecret,
      @Value("${fsp.fam.scope:}") String scope,
      @Value("${ca.bc.gov.nrs.identity-lookup.connect-timeout:5s}") Duration connectTimeout,
      @Value("${ca.bc.gov.nrs.identity-lookup.read-timeout:10s}") Duration readTimeout) {
    if (baseUrl == null || baseUrl.isBlank()) {
      throw new IllegalStateException(
          "fsp.notification.designate.enabled=true but"
              + " ca.bc.gov.nrs.identity-lookup.base-url is blank — set IDENTITY_LOOKUP_BASE_URL");
    }
    this.clientCredentials = ClientCredentialsTokenSource.fromProps(
        tokenUrl, clientId, clientSecret, scope, connectTimeout, readTimeout);
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
    factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));
    this.http = RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(factory)
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();
    if (this.clientCredentials != null) {
      log.info(
          "FAM designate-email resolver active (OAuth2 client_credentials — "
              + "token-url={}, client-id={}{}",
          this.clientCredentials.tokenUrl,
          this.clientCredentials.clientId,
          this.clientCredentials.scope.isBlank()
              ? ")"
              : ", scope=" + this.clientCredentials.scope + ")");
    } else {
      log.info(
          "FAM designate-email resolver active (no auth configured — "
              + "calls will be unauthenticated; set "
              + "FSP_FAM_TOKEN_URL/CLIENT_ID/CLIENT_SECRET if FAM requires auth)");
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
            // FAM's identity-lookup uses `userId` when called with a
            // user-token JWT (UserDirectoryService path) but the
            // service-to-service handler expects `username` instead —
            // hitting it with `userId` only yields a 500 KeyError on
            // 'username'. Send both so FAM is happy regardless of
            // which handler the OAuth2 access token routes through.
            uriBuilder.path(SEARCH_PATH)
                .queryParam("pageSize", UPSTREAM_PAGE_SIZE)
                .queryParam("userId", bare)
                .queryParam("username", bare);
            URI uri = uriBuilder.build();
            log.debug("FAM lookup for designate {}: {}", designateIdir, uri);
            return uri;
          });
      String authToken = resolveAuthToken();
      if (!authToken.isBlank()) {
        request = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + authToken);
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

  /**
   * Picks the auth token for the next FAM call from the
   * client-credentials cache. Returns {@code ""} when no service
   * account is configured so the caller leaves the Authorization
   * header off.
   */
  private String resolveAuthToken() {
    if (clientCredentials == null) return "";
    Instant now = Instant.now();
    if (!cachedAccessToken.isBlank()
        && now.isBefore(cachedAccessTokenExpiresAt.minusSeconds(60))) {
      return cachedAccessToken;
    }
    try {
      ClientCredentialsTokenSource.Token fresh = clientCredentials.fetch();
      cachedAccessToken = fresh.accessToken();
      cachedAccessTokenExpiresAt = now.plusSeconds(fresh.expiresInSeconds());
      return cachedAccessToken;
    } catch (RuntimeException ex) {
      log.warn("FAM client_credentials token fetch failed ({}); "
          + "next lookup will retry", ex.getMessage());
      cachedAccessToken = "";
      cachedAccessTokenExpiresAt = Instant.EPOCH;
      return "";
    }
  }

  /**
   * Encapsulates the OAuth2 client_credentials exchange. Owns its own
   * RestClient (different base URL than the FAM lookup), the basic
   * auth header derived from client_id/client_secret, and the form
   * body. Returned tokens are short-lived JWTs; the parent resolver
   * caches them between {@link #fetch()} calls.
   */
  private static final class ClientCredentialsTokenSource {
    private final RestClient http;
    private final String tokenUrl;
    private final String clientId;
    private final String scope;
    private final String basicAuthHeader;

    private ClientCredentialsTokenSource(
        RestClient http, String tokenUrl, String clientId, String scope, String basicAuthHeader) {
      this.http = http;
      this.tokenUrl = tokenUrl;
      this.clientId = clientId;
      this.scope = scope;
      this.basicAuthHeader = basicAuthHeader;
    }

    /**
     * @return a configured source when all three of token-url /
     *     client-id / client-secret are non-blank; {@code null}
     *     when client-credentials auth wasn't requested at all
     *     (lets the caller fall back to unauthenticated).
     */
    static ClientCredentialsTokenSource fromProps(
        String tokenUrl, String clientId, String clientSecret, String scope,
        Duration connectTimeout, Duration readTimeout) {
      String t = tokenUrl == null ? "" : tokenUrl.trim();
      String id = clientId == null ? "" : clientId.trim();
      String secret = clientSecret == null ? "" : clientSecret.trim();
      String sc = scope == null ? "" : scope.trim();
      if (t.isBlank() && id.isBlank() && secret.isBlank()) return null;
      if (t.isBlank() || id.isBlank() || secret.isBlank()) {
        throw new IllegalStateException(
            "FAM client_credentials misconfigured — set ALL of "
                + "FSP_FAM_TOKEN_URL, FSP_FAM_CLIENT_ID, FSP_FAM_CLIENT_SECRET "
                + "(or none).");
      }
      SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
      factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
      factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));
      RestClient http = RestClient.builder()
          .requestFactory(factory)
          .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
          .build();
      String basic = "Basic " + Base64.getEncoder().encodeToString(
          (id + ":" + secret).getBytes(StandardCharsets.UTF_8));
      return new ClientCredentialsTokenSource(http, t, id, sc, basic);
    }

    Token fetch() {
      MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
      form.add("grant_type", "client_credentials");
      if (!scope.isBlank()) form.add("scope", scope);
      TokenResponse resp = http.post()
          .uri(URI.create(tokenUrl))
          .header(HttpHeaders.AUTHORIZATION, basicAuthHeader)
          .contentType(MediaType.APPLICATION_FORM_URLENCODED)
          .body(form)
          .retrieve()
          .body(TokenResponse.class);
      if (resp == null || resp.accessToken() == null || resp.accessToken().isBlank()) {
        throw new IllegalStateException("token endpoint returned no access_token");
      }
      // Cognito returns expires_in in seconds (typically 3600). Default
      // to 5 minutes if the server omits it so we still rotate
      // reasonably often.
      long ttl = resp.expiresIn() == null || resp.expiresIn() <= 0 ? 300L : resp.expiresIn();
      return new Token(resp.accessToken(), ttl);
    }

    // Token endpoints typically return extra fields (refresh_token,
    // id_token, scope, ...); ignore them so the global
    // fail-on-unknown-properties=true setting can't break the exchange.
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record TokenResponse(
        @JsonProperty("access_token") String accessToken,
        @JsonProperty("expires_in") Long expiresIn,
        @JsonProperty("token_type") String tokenType) {}

    record Token(String accessToken, long expiresInSeconds) {}
  }
}
