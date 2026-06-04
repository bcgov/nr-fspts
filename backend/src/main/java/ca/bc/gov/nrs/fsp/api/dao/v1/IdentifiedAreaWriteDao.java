package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Write DAO for FSP_IDENTIFIED_AREA + FSP_IDENTIFIED_AREA_GEOMETRY.
 * Bypasses PL/SQL — FSP_650_IDENTIFIED_AREAS_MAP only exposes a
 * read-only {@code get} proc. The BEFORE-INSERT trigger
 * {@code FSP_FIAG_MCT_TRG} runs spatial validation on writes.
 */
public interface IdentifiedAreaWriteDao {

  /** {@code SELECT FSP_IDENTIFIED_AREA_SEQ.NEXTVAL FROM DUAL}. */
  long nextIdentifiedAreaId();

  /**
   * Cached lookup for the FEATURE_CLASS_SKEY corresponding to the
   * identified-area feature class. TODO: confirm the lookup criteria
   * with the DBAs — currently matched by NAME='Identified Area'.
   */
  long lookupIdentifiedAreaFeatureClassSkey();

  void insertIdentifiedAreaHeader(
      long fspId,
      long amendmentNumber,
      long identifiedAreaId,
      String legislationTypeCode,
      String identifiedAreaName,
      String userId);

  void insertIdentifiedAreaGeometry(
      long fspId,
      long amendmentNumber,
      long identifiedAreaId,
      long featureClassSkey,
      String wkt,
      int srid,
      double featureAreaHa,
      double featurePerimeterKm,
      String userId);
}
