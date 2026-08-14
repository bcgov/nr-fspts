package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * Result of {@code POST /v1/fsp} — just enough for the dialog to navigate
 * straight into the plan it created. The proc assigns both values (fsp_id from
 * FSP_SEQ, amendment 0 for an original), so neither is known client-side until
 * the create returns.
 */
public record FspCreated(String fspId, String fspAmendmentNumber) {
}
