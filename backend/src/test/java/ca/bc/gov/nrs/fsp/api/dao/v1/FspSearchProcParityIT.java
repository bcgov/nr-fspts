package ca.bc.gov.nrs.fsp.api.dao.v1;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Acceptance gate for swapping FSP search off {@code FSP_100_SEARCH.MAINLINE}
 * onto {@link FspSearchDirectDao}: for the same inputs and the same role +
 * client, the two must return the <b>same set of FSP rows</b>. Diffing the
 * (fspId, amendmentNumber) sets is what proves the visibility predicate and
 * filters were ported faithfully — the security-critical property.
 *
 * <p>Hits the real Oracle, so it's gated: run locally on the VPN with the
 * {@code local} profile and {@code RUN_SEARCH_PARITY=true}. It is skipped in
 * CI (no DB). Set the env vars below to data that actually exists in the
 * target DB.
 *
 * <pre>
 *   RUN_SEARCH_PARITY=true \
 *   PARITY_DISTRICT_ORG=1894 \
 *   PARITY_SUBMITTER_CLIENT=00012345 \
 *   mvn -Dtest=FspSearchProcParityIT test
 * </pre>
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "RUN_SEARCH_PARITY", matches = "true")
class FspSearchProcParityIT {

  @Autowired Fsp100SearchDao procDao;
  @Autowired FspSearchDirectDao directDao;

  private static String env(String name, String dflt) {
    String v = System.getenv(name);
    return v == null || v.isBlank() ? dflt : v;
  }

  private static String key(Fsp100SearchDao.Row r) {
    return r.fspId() + "/" + r.fspAmendmentNumber();
  }

  /**
   * Runs both paths with identical inputs + role/client and asserts the
   * returned FSP-row sets are identical.
   */
  private void assertParity(String label, String role, String client,
      String orgUnitNo, String status) {
    List<Fsp100SearchDao.Row> proc = procDao.mainline(
        "GET", "", "", n(orgUnitNo), "", "", n(client), "", role,
        "", "", "", n(status), "", 0).rows();

    List<Fsp100SearchDao.Row> direct = directDao.search(new FspSearchDirectDao.SearchCriteria(
        "", "", n(orgUnitNo), "", "", "", "", "", n(status), "", client, role));

    Set<String> procKeys = proc.stream().map(FspSearchProcParityIT::key).collect(Collectors.toSet());
    Set<String> directKeys = direct.stream().map(FspSearchProcParityIT::key).collect(Collectors.toSet());

    assertThat(directKeys)
        .as("%s — proc returned %d rows, direct %d; "
            + "only-in-proc=%s only-in-direct=%s",
            label, proc.size(), direct.size(),
            minus(procKeys, directKeys), minus(directKeys, procKeys))
        .isEqualTo(procKeys);
  }

  private static Set<String> minus(Set<String> a, Set<String> b) {
    return a.stream().filter(x -> !b.contains(x)).limit(20).collect(Collectors.toSet());
  }

  private static String n(String s) {
    return s == null ? "" : s;
  }

  @Test
  void administrator_broadSearch_matches() {
    assertParity("admin / no filter", "FSP_ADMINISTRATOR,", null, null, null);
  }

  @Test
  void administrator_districtFilter_matches() {
    // The case that exposed the perf cliff — must still return the same rows.
    assertParity("admin / district", "FSP_ADMINISTRATOR,", null,
        env("PARITY_DISTRICT_ORG", "1894"), null);
  }

  @Test
  void submitter_scopedToOwnOrg_matches() {
    assertParity("submitter / own org", "FSP_SUBMITTER,",
        env("PARITY_SUBMITTER_CLIENT", "00012345"), null, null);
  }

  @Test
  void viewOnly_scopedAndApproved_matches() {
    assertParity("view-only / own approved", "FSP_VIEW_ONLY,",
        env("PARITY_SUBMITTER_CLIENT", "00012345"), null, null);
  }
}
