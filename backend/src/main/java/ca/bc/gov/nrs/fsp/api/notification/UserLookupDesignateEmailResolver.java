package ca.bc.gov.nrs.fsp.api.notification;

import ca.bc.gov.nrs.fsp.api.client.UserLookupClient;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * {@link DesignateEmailResolver} backed by nr-user-lookup-api via
 * {@link UserLookupClient} — the same client the in-request user picker
 * uses. Resolves a designate's email from their IDIR username.
 *
 * <p>The batch runs on a scheduler thread where there is no security
 * context; {@link UserLookupClient} authenticates with FSP's own
 * Keycloak {@code client_credentials} service account, so no caller JWT
 * is needed.
 *
 * <p>Active only when {@code fsp.notification.designate.enabled=true}.
 */
@Component
@ConditionalOnProperty(
    prefix = "fsp.notification.designate",
    name = "enabled",
    havingValue = "true")
@Slf4j
public class UserLookupDesignateEmailResolver implements DesignateEmailResolver {

  private final UserLookupClient client;

  public UserLookupDesignateEmailResolver(UserLookupClient client) {
    this.client = client;
    log.info("Designate-email resolver active (nr-user-lookup-api via UserLookupClient)");
  }

  @Override
  public Optional<String> resolveEmail(String designateIdir) {
    if (designateIdir == null || designateIdir.isBlank()) {
      return Optional.empty();
    }
    // The designate table stores the full "IDIR\NAME" form; the lookup
    // API keys on the bare username. Mirror UserDirectoryService.
    String bare = designateIdir.contains("\\")
        ? designateIdir.substring(designateIdir.indexOf('\\') + 1)
        : designateIdir;
    try {
      return client.getIdirDetail(bare)
          .map(UserLookupClient.IdirUser::email)
          .filter(e -> e != null && !e.isBlank());
    } catch (RuntimeException ex) {
      log.warn("user-lookup failed for designate {} ({})", designateIdir, ex.getMessage());
      return Optional.empty();
    }
  }
}
