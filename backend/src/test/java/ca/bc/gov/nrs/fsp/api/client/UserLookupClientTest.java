package ca.bc.gov.nrs.fsp.api.client;

import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.BceidUser;
import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.IdirUser;
import ca.bc.gov.nrs.fsp.api.client.UserLookupClient.SearchBy;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.queryParam;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * HTTP-contract tests for {@link UserLookupClient} against the
 * nr-user-lookup-api endpoints, using a {@link MockRestServiceServer}.
 */
class UserLookupClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private UserLookupClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://lookup.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new UserLookupClient(builder.build());
  }

  @Test
  void searchIdir_postsQueryParamsAndMapsItems() {
    server.expect(requestTo(org.hamcrest.Matchers.startsWith(
            "http://lookup.test/api/v1/user-lookup/idir-users/search")))
        .andExpect(method(HttpMethod.POST))
        .andExpect(queryParam("userId", "smith"))
        .andExpect(queryParam("firstName", "jane"))
        .andRespond(withSuccess(
            "{\"totalItems\":1,\"pageSize\":10,\"items\":["
                + "{\"userId\":\"JSMITH\",\"guid\":\"g1\",\"firstName\":\"Jane\","
                + "\"lastName\":\"Smith\",\"email\":\"jane@gov.bc.ca\"}]}",
            MediaType.APPLICATION_JSON));

    List<IdirUser> users = client.searchIdir("smith", "jane", null);

    server.verify();
    assertThat(users).hasSize(1);
    assertThat(users.get(0).userId()).isEqualTo("JSMITH");
    assertThat(users.get(0).email()).isEqualTo("jane@gov.bc.ca");
  }

  @Test
  void getIdirDetail_foundTrueMapsToUser() {
    server.expect(requestTo(org.hamcrest.Matchers.startsWith(
            "http://lookup.test/api/v1/user-lookup/idir-account-detail")))
        .andExpect(method(HttpMethod.GET))
        .andExpect(queryParam("userId", "JSMITH"))
        .andRespond(withSuccess(
            "{\"found\":true,\"userId\":\"JSMITH\",\"guid\":\"g1\","
                + "\"firstName\":\"Jane\",\"lastName\":\"Smith\","
                + "\"email\":\"jane@gov.bc.ca\"}",
            MediaType.APPLICATION_JSON));

    Optional<IdirUser> user = client.getIdirDetail("JSMITH");

    server.verify();
    assertThat(user).isPresent();
    assertThat(user.get().email()).isEqualTo("jane@gov.bc.ca");
  }

  @Test
  void getIdirDetail_foundFalseIsEmpty() {
    server.expect(method(HttpMethod.GET))
        .andRespond(withSuccess(
            "{\"found\":false}", MediaType.APPLICATION_JSON));

    assertThat(client.getIdirDetail("NOBODY")).isEmpty();
    server.verify();
  }

  @Test
  void getBusinessBceid_foundTrueMapsToUser() {
    server.expect(requestTo(org.hamcrest.Matchers.startsWith(
            "http://lookup.test/api/v1/user-lookup/businessBceid")))
        .andExpect(method(HttpMethod.GET))
        .andExpect(queryParam("searchUserBy", "userId"))
        .andExpect(queryParam("searchValue", "bob"))
        .andRespond(withSuccess(
            "{\"found\":true,\"userId\":\"bob\",\"guid\":\"g2\","
                + "\"businessGuid\":\"bg\",\"businessLegalName\":\"Acme\","
                + "\"firstName\":\"Bob\",\"lastName\":\"Jones\","
                + "\"email\":\"bob@acme.com\"}",
            MediaType.APPLICATION_JSON));

    Optional<BceidUser> user = client.getBusinessBceid(SearchBy.userId, "bob");

    server.verify();
    assertThat(user).isPresent();
    assertThat(user.get().businessLegalName()).isEqualTo("Acme");
    assertThat(user.get().email()).isEqualTo("bob@acme.com");
  }
}
