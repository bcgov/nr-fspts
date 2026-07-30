package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * Batch request for {@code POST /users/resolve} — a list of user ids (IDIR
 * or BCeID, bare or {@code DIR\name}-prefixed) to resolve to display names.
 * Unknown JSON properties are ignored so a slightly richer client payload
 * doesn't 400.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record UserResolveRequest(List<String> userIds) {
}
