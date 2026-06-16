package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * Response from {@code POST /v1/fsp/{fspId}/extensions}. Carries the
 * proc-assigned extension id so the SPA can deep-link or refresh the
 * summary list without a separate GET round-trip.
 */
public record ExtensionRequestSaved(String extensionId) {}
