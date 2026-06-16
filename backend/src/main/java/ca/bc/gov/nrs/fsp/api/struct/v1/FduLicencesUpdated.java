package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Response from {@code PUT /v1/fsp/{fspId}/fdus/{fduId}/licences} —
 * the refreshed licence list for the FDU plus per-id counts so the SPA
 * can confirm what actually happened (duplicates skipped, etc.).
 */
public record FduLicencesUpdated(
    List<String> licences,
    int added,
    int removed,
    int skippedAlreadyPresent) {}
