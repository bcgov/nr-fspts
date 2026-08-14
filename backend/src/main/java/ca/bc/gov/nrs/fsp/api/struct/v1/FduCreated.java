package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * Result of {@code POST /v1/fsp/{fspId}/fdus}. The measured area and
 * perimeter are echoed back because they're computed server-side from the
 * pasted boundary — showing them is how the user confirms the geometry landed
 * as the shape they meant.
 */
public record FduCreated(
    String fduId,
    String fduName,
    String fspAmendmentNumber,
    double areaHa,
    double perimeterKm,
    int licencesAttached) {
}
