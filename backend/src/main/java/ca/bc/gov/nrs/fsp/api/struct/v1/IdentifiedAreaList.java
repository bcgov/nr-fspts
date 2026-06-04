package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Flat list of identified/declared areas for an FSP. Each row is tagged
 * with its legislation type so the front-end can render a single
 * combined table with a "FRPA Section" column instead of the legacy's
 * three sub-tabs.
 */
public record IdentifiedAreaList(List<IdentifiedArea> areas) {

  public record IdentifiedArea(
      String identifiedAreaId,
      String identifiedAreaName,
      /** Raw proc legislation type code (e.g. FRPA196(1)). */
      String legislationType,
      /** Pretty label for the column ("FRPA s.196(1)"). */
      String legislationLabel
  ) {}
}
