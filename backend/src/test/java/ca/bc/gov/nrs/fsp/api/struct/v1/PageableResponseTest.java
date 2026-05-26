package ca.bc.gov.nrs.fsp.api.struct.v1;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Covers the {@code ofProbedPage} factory used by FspService.search after
 * the move from drain-everything-then-slice to a bounded REF CURSOR
 * read. The hasNext signaling is the load-bearing bit — Carbon
 * Pagination relies on totalElements to enable/disable the Next button,
 * and the only way the front-end knows there are more results is via
 * a totalElements that exceeds {@code (page+1)*size}.
 */
class PageableResponseTest {

  private static List<Integer> ints(int n) {
    return IntStream.range(0, n).boxed().toList();
  }

  @Test
  void exactPageSize_noNextPage() {
    // Caller probed (page+1)*size+1 = 11 rows for size=10; cursor only
    // had 10 rows so probed.size() == 10. Page is full, no next page.
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(ints(10), 0, 10);
    assertThat(p.getContent()).hasSize(10);
    assertThat(p.getPage().getTotalElements()).isEqualTo(10);
    assertThat(p.getPage().getTotalPages()).isEqualTo(1);
  }

  @Test
  void probeOverflow_signalsNextPage() {
    // Caller probed 11 for size=10, cursor returned all 11. We slice to
    // the first 10 for display, but totalElements becomes 11 so Carbon
    // shows the Next button enabled.
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(ints(11), 0, 10);
    assertThat(p.getContent()).hasSize(10);
    assertThat(p.getPage().getTotalElements()).isEqualTo(11);
    assertThat(p.getPage().getTotalPages()).isEqualTo(2);
  }

  @Test
  void midPageWithMore() {
    // page=2 size=10 → probed up to 31 rows. 31 came back, so the slice
    // for page 2 is rows 20..29 and totalElements signals "at least one
    // more page".
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(ints(31), 2, 10);
    assertThat(p.getContent()).containsExactlyElementsOf(ints(30).subList(20, 30));
    assertThat(p.getPage().getNumber()).isEqualTo(2);
    assertThat(p.getPage().getTotalElements()).isEqualTo(31);
    assertThat(p.getPage().getTotalPages()).isEqualTo(4);
  }

  @Test
  void shortRead_lastPage() {
    // probed=15 for page=1 size=10 → from=10, to=15, content has 5 rows,
    // no next page (15 not > 20).
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(ints(15), 1, 10);
    assertThat(p.getContent()).hasSize(5);
    assertThat(p.getPage().getTotalElements()).isEqualTo(15);
    assertThat(p.getPage().getTotalPages()).isEqualTo(2);
  }

  @Test
  void pageBeyondData_isEmpty() {
    // User navigates to a page past the actual data (race, stale UI,
    // shrunk result set). from/to both clamp to data length so we
    // return an empty content list instead of an out-of-bounds slice.
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(ints(5), 10, 10);
    assertThat(p.getContent()).isEmpty();
    assertThat(p.getPage().getTotalElements()).isEqualTo(5);
  }

  @Test
  void emptyProbe() {
    PageableResponse<Integer> p = PageableResponse.ofProbedPage(List.of(), 0, 10);
    assertThat(p.getContent()).isEmpty();
    assertThat(p.getPage().getTotalElements()).isZero();
    assertThat(p.getPage().getTotalPages()).isZero();
  }
}
