package ca.bc.gov.nrs.fsp.api.notification;

import ca.bc.gov.nrs.fsp.api.client.UserLookupClient;
import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.IdirUser;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link UserLookupDesignateEmailResolver} resolves a designate's email
 * from their IDIR username via {@link UserLookupClient#getIdirDetail}.
 */
class UserLookupDesignateEmailResolverTest {

  private final UserLookupClient client = mock(UserLookupClient.class);
  private final UserLookupDesignateEmailResolver resolver =
      new UserLookupDesignateEmailResolver(client);

  @Test
  void resolveEmail_stripsPrefixAndReturnsEmail() {
    when(client.getIdirDetail("JSMITH")).thenReturn(Optional.of(
        new IdirUser("JSMITH", "guid", "Jane", "Smith", "jane@gov.bc.ca")));

    Optional<String> email = resolver.resolveEmail("IDIR\\JSMITH");

    verify(client).getIdirDetail("JSMITH");
    assertThat(email).contains("jane@gov.bc.ca");
  }

  @Test
  void resolveEmail_emptyWhenNoMatch() {
    when(client.getIdirDetail("NOBODY")).thenReturn(Optional.empty());
    assertThat(resolver.resolveEmail("NOBODY")).isEmpty();
  }

  @Test
  void resolveEmail_emptyWhenMatchHasBlankEmail() {
    when(client.getIdirDetail("NOEMAIL")).thenReturn(Optional.of(
        new IdirUser("NOEMAIL", "guid", "No", "Email", " ")));
    assertThat(resolver.resolveEmail("NOEMAIL")).isEmpty();
  }

  @Test
  void resolveEmail_emptyOnBlankInput() {
    assertThat(resolver.resolveEmail(null)).isEmpty();
    assertThat(resolver.resolveEmail("  ")).isEmpty();
  }

  @Test
  void resolveEmail_emptyOnUpstreamError() {
    when(client.getIdirDetail("BOOM")).thenThrow(new RuntimeException("upstream 500"));
    assertThat(resolver.resolveEmail("BOOM")).isEmpty();
  }
}
