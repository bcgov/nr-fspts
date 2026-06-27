package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Wire-compatible with Spring Data's Page&lt;T&gt; JSON serialization so the
 * REPT frontend's TableResource shape works without an adapter layer
 * (FSP doesn't import TableResource yet, but matching the shape now
 * keeps the door open).
 *
 * <p>The underlying PL/SQL packages (e.g. FSP_100_SEARCH.MAINLINE) don't
 * support cursor-side pagination — they return every matching row in a
 * single REF CURSOR. The service layer reads the full cursor, sorts in
 * memory, then slices for the requested page. This mirrors what the
 * legacy JSP did with its &lt;pg:pager&gt; widget.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PageableResponse<T> {

  private List<T> content;
  private PageInfo page;

  @Data
  @Builder
  @NoArgsConstructor
  @AllArgsConstructor
  public static class PageInfo {
    private int size;
    private int number; // 0-indexed
    private long totalElements;
    private int totalPages;
  }

  /**
   * Build a page envelope when the data source already paginated and
   * returned just this page's {@code content} plus the exact
   * {@code totalElements} (e.g. a SQL {@code OFFSET/FETCH} query + a
   * {@code COUNT(*)}). No in-memory slicing — {@code content} is emitted
   * verbatim.
   */
  public static <T> PageableResponse<T> ofPage(List<T> content, int page, int size, long totalElements) {
    int totalPages = size > 0 ? (int) Math.ceil((double) totalElements / size) : 0;
    return PageableResponse.<T>builder()
        .content(content)
        .page(PageInfo.builder()
            .size(size)
            .number(page)
            .totalElements(totalElements)
            .totalPages(totalPages)
            .build())
        .build();
  }

  public static <T> PageableResponse<T> of(List<T> fullList, int page, int size) {
    int total = fullList.size();
    int totalPages = size > 0 ? (int) Math.ceil((double) total / size) : 0;
    int from = Math.min(page * size, total);
    int to = Math.min(from + size, total);
    return PageableResponse.<T>builder()
        .content(fullList.subList(from, to))
        .page(PageInfo.builder()
            .size(size)
            .number(page)
            .totalElements(total)
            .totalPages(totalPages)
            .build())
        .build();
  }

  /**
   * Build a page envelope when the caller only read enough rows for the
   * current page (+1 for a hasNext probe) instead of draining the whole
   * source. {@code probedRows} is the slice the caller actually has on
   * hand, indexed from the start of the data set (NOT from the current
   * page offset); pass it as-is from a bounded {@code readCursor} call.
   *
   * <p>If {@code probedRows.size() > page*size+size} we know at least
   * one more row exists in the source, so totalElements/totalPages are
   * lower bounds (Carbon Pagination will show one extra page enabled
   * past the current one — user clicks Next, we probe again).</p>
   */
  public static <T> PageableResponse<T> ofProbedPage(List<T> probedRows, int page, int size) {
    int from = Math.min(page * size, probedRows.size());
    int to = Math.min(from + size, probedRows.size());
    boolean hasMore = probedRows.size() > from + size;
    long totalElements = hasMore ? (long) from + size + 1 : probedRows.size();
    int totalPages = size > 0
        ? (int) Math.ceil((double) totalElements / size)
        : 0;
    return PageableResponse.<T>builder()
        .content(probedRows.subList(from, to))
        .page(PageInfo.builder()
            .size(size)
            .number(page)
            .totalElements(totalElements)
            .totalPages(totalPages)
            .build())
        .build();
  }
}
