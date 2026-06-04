package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps THE.FSP_650_IDENTIFIED_AREAS_MAP.GET — returns the identified
 * area list for one legislation type at a time. The legacy app issues
 * three calls (FRPA196(1), FRPA196(2), FPPR14(4)) to populate its
 * three sub-tabs; we union the three calls in the service layer to
 * surface a single flat table tagged with each row's legislation type.
 */
public interface Fsp650IdentifiedAreasMapDao {

  String PACKAGE_NAME = "FSP_650_IDENTIFIED_AREAS_MAP";
  String PROCEDURE_NAME = "GET";

  List<IdentifiedAreaRow> get(
      String fspId, String legislationType,
      String userClientNumber, String userRole);

  record IdentifiedAreaRow(String identifiedAreaId, String identifiedAreaName) {}
}
