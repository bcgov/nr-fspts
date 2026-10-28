package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * Result of an Administrator revert.
 *
 * @param previousStatusCode APP or INE
 * @param newStatusCode SUB (from APP) or DFT (from INE)
 * @param standardsKeptApproved non-default standards on the amendment that
 *     remain Approved after the revert
 */
public record AmendmentRevertResponse(
    String fspId,
    String amendmentNumber,
    String previousStatusCode,
    String newStatusCode,
    int standardsKeptApproved) {}
