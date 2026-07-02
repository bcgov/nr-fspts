package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.client.UserLookupClient;
import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.IdirUser;
import ca.bc.gov.nrs.fsp.api.struct.v1.UserSearchResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.UserSummary;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * In-request IDIR user directory backed by {@link UserLookupClient}
 * (nr-user-lookup-api). Consumed by the {@code /users} picker endpoint
 * and district-notification designate enrichment.
 *
 * <p>Authentication is handled entirely by {@link UserLookupClient}
 * via a Keycloak {@code client_credentials} service-account token — the
 * caller's Cognito JWT is no longer forwarded to the lookup API.
 *
 * <h3>Configuration</h3>
 * <ul>
 *   <li>{@code fsp.user-lookup.*} — see {@link UserLookupClient}</li>
 *   <li>{@code ca.bc.gov.nrs.user-directory.default-page-size} —
 *       defaults to 50 when the caller doesn't specify</li>
 * </ul>
 */
@Service
public class UserDirectoryService {

  private static final Logger LOG = LoggerFactory.getLogger(UserDirectoryService.class);

  private static final Comparator<UserSummary> USER_COMPARATOR =
      Comparator.comparing(UserSummary::displayName,
              Comparator.nullsLast(String::compareToIgnoreCase))
          .thenComparing(UserSummary::userId,
              Comparator.nullsLast(String::compareToIgnoreCase));

  private final UserLookupClient client;
  private final int defaultPageSize;

  public UserDirectoryService(
      UserLookupClient client,
      @Value("${ca.bc.gov.nrs.user-directory.default-page-size:50}") int defaultPageSize) {
    this.client = client;
    this.defaultPageSize = defaultPageSize;
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

    List<IdirUser> items = client.searchIdir(normUserId, normFirstName, normLastName);
    List<UserSummary> results = mapItems(items);
    long total = results.size();
    if (results.size() > requestedSize) {
      results = results.subList(0, requestedSize);
    }

    LOG.debug("user-lookup search [{} {} {}] returned {} of {} results",
        normUserId, normFirstName, normLastName, results.size(), total);

    return new UserSearchResponse(results, total, 0, requestedSize);
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
    // nr-user-lookup-api keys on the bare IDIR name (no "IDIR\" prefix);
    // the designate table sometimes carries the full "IDIR\NAME" form,
    // so strip the directory part if present before querying. Prefer the
    // exact idir-account-detail endpoint over search.
    String bare = userId.contains("\\") ? userId.substring(userId.indexOf('\\') + 1) : userId;
    try {
      return client.getIdirDetail(bare)
          .map(UserDirectoryService::toSummary)
          .filter(Objects::nonNull);
    } catch (RuntimeException ex) {
      LOG.debug("user-lookup miss for userId={} ({})", userId, ex.getMessage());
      return Optional.empty();
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private List<UserSummary> mapItems(List<IdirUser> items) {
    if (items == null || items.isEmpty()) return List.of();
    return items.stream()
        .filter(Objects::nonNull)
        .map(UserDirectoryService::toSummary)
        .filter(Objects::nonNull)
        .sorted(USER_COMPARATOR)
        .toList();
  }

  private static UserSummary toSummary(IdirUser user) {
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
}
