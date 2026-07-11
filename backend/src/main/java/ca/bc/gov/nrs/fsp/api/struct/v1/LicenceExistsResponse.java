package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * Response from {@code GET /v1/fsp/{fspId}/licence-exists} — whether the
 * given licence number is present in {@code PROV_FOREST_USE}. Drives the
 * Edit-licences dialog's per-add validation so a bad number is caught on
 * the Add click instead of failing the whole batch at save time.
 *
 * @param licenceNumber the normalised (trimmed, upper-cased) number checked
 * @param exists        true when the number exists in the registry
 */
public record LicenceExistsResponse(String licenceNumber, boolean exists) {}
