package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.client.UserLookupClient;
import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.IdirUser;
import ca.bc.gov.nrs.fsp.api.struct.v1.UserSearchResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.UserSummary;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link UserDirectoryService} delegates to {@link UserLookupClient}
 * (nr-user-lookup-api). These tests mock the client and verify the
 * UserSummary mapping, sorting, page-size slice semantics, and the
 * findByUserId → idir-account-detail path.
 */
class UserDirectoryServiceTest {

  private final UserLookupClient client = mock(UserLookupClient.class);
  private final UserDirectoryService service = new UserDirectoryService(client, 50);

  @Test
  void searchUsers_mapsToUserSummaryAndSorts() {
    when(client.searchIdir("smith", null, null)).thenReturn(List.of(
        new IdirUser("BSMITH", "guid-b", "Bob", "Smith", "bob@gov.bc.ca"),
        new IdirUser("ASMITH", "guid-a", "Ann", "Smith", "ann@gov.bc.ca")));

    UserSearchResponse resp = service.searchUsers("smith", null, null, 10);

    assertThat(resp.total()).isEqualTo(2);
    // Sorted by displayName: "Ann Smith" before "Bob Smith".
    assertThat(resp.results()).extracting(UserSummary::userId)
        .containsExactly("ASMITH", "BSMITH");
    UserSummary ann = resp.results().get(0);
    assertThat(ann.displayName()).isEqualTo("Ann Smith");
    assertThat(ann.email()).isEqualTo("ann@gov.bc.ca");
    assertThat(ann.idirGuid()).isEqualTo("guid-a");
  }

  @Test
  void searchUsers_clampsResultsToRequestedSize() {
    when(client.searchIdir(isNull(), eq("jo"), isNull())).thenReturn(List.of(
        new IdirUser("A", null, "Alice", "Jones", null),
        new IdirUser("B", null, "Bob", "Jones", null),
        new IdirUser("C", null, "Carol", "Jones", null)));

    UserSearchResponse resp = service.searchUsers(null, "jo", null, 2);

    assertThat(resp.total()).isEqualTo(3);
    assertThat(resp.results()).hasSize(2);
    assertThat(resp.size()).isEqualTo(2);
  }

  @Test
  void searchUsers_rejectsAllBlankCriteria() {
    assertThatThrownBy(() -> service.searchUsers(" ", null, "", 10))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void findByUserId_usesIdirDetailAndStripsPrefix() {
    when(client.getIdirDetail("JSMITH")).thenReturn(Optional.of(
        new IdirUser("JSMITH", "guid-j", "Jane", "Smith", "jane@gov.bc.ca")));

    Optional<UserSummary> result = service.findByUserId("IDIR\\JSMITH");

    verify(client).getIdirDetail("JSMITH");
    assertThat(result).isPresent();
    assertThat(result.get().displayName()).isEqualTo("Jane Smith");
    assertThat(result.get().email()).isEqualTo("jane@gov.bc.ca");
  }

  @Test
  void findByUserId_emptyOnMiss() {
    when(client.getIdirDetail("NOBODY")).thenReturn(Optional.empty());
    assertThat(service.findByUserId("NOBODY")).isEmpty();
  }

  @Test
  void findByUserId_emptyOnUpstreamError() {
    when(client.getIdirDetail("BOOM")).thenThrow(new RuntimeException("upstream 500"));
    assertThat(service.findByUserId("BOOM")).isEmpty();
  }
}
