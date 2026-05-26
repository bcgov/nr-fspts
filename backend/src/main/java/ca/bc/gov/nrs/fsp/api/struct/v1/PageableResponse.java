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
}
