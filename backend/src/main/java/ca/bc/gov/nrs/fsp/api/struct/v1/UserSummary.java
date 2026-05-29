package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One IDIR user returned by the FAM identity-lookup API. Mirrors
 * nr-rept's ReptUserSummaryDto so the front-end shape is portable.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserSummary(
    String userId,
    String displayName,
    String firstName,
    String lastName,
    String email,
    String idirGuid,
    String idirUserGuid
) {
}
