package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Write DAO for FOREST_DEVELOPMENT_UNIT, FOREST_DEVELOPMENT_UNIT_GEOM,
 * and FDU_LICENCE_XREF. Bypasses PL/SQL — none of the FSP_600 procs
 * carry write actions today, so this layer issues raw INSERTs the way
 * the legacy ESF agent did. The BEFORE-INSERT trigger
 * {@code FSP_FDUG_MCT_TRG} still runs spatial validation against the
 * inserted geometry.
 */
public interface FduWriteDao {

  /** {@code SELECT FDU_SEQ.NEXTVAL FROM DUAL}. */
  long nextFduId();

  /**
   * Looks up the FEATURE_CLASS_SKEY for the FDU geometry feature class.
   * Cached after the first call. TODO: confirm the lookup criteria with
   * the DBAs — currently matched by NAME='Forest Development Unit'.
   */
  long lookupFduFeatureClassSkey();

  void insertFduHeader(
      long fspId, long amendmentNumber, long fduId, String fduName, String userId);

  /**
   * Geometry insert uses an anonymous PL/SQL block so we can stamp
   * the SRID onto the SDO_GEOMETRY value parsed from WKT.
   */
  void insertFduGeometry(
      long fspId,
      long amendmentNumber,
      long fduId,
      long featureClassSkey,
      String wkt,
      int srid,
      double featureAreaHa,
      double featurePerimeterKm,
      String userId);

  void insertFduLicence(
      long fspId, long amendmentNumber, long fduId, String forestFileId, String userId);
}
