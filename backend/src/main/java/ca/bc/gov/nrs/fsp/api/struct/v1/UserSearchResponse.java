package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

public record UserSearchResponse(
    List<UserSummary> results,
    long total,
    int page,
    int size
) {
}
