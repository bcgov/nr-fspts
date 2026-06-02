package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Read-only projection of FSP_600_MAP.GET — the per-FDU list the
 * FDU/Map screen renders ("FDU records with spatial from Amendment #N").
 */
public record FduList(
    String fduAmendmentNumber,
    List<Fdu> fdus
) {

  public record Fdu(
      String fduId,
      String fduName,
      String licences
  ) {}
}
