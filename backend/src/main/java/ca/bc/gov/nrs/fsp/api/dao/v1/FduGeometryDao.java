package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.sql.Struct;
import java.util.List;

/**
 * Wraps the FSP_COMMON geometry functions (legacy: fdu/dao/FDUGeometryDAO.java).
 *
 * fdu_geometry_gets returns either MDSYS.SDO_GEOMETRY (single FDU) or a CURSOR
 * (FSP + amendment scope).
 *
 * Geometry is exposed as a raw java.sql.Struct so callers can pass it through
 * to a spatial library or to GeoJSON conversion without this layer taking a
 * dependency on Oracle's Spatial classes.
 */
public interface FduGeometryDao {

  String PACKAGE_NAME = "FSP_COMMON";

  /** fdu_geometry_gets(?) where the OUT is MDSYS.SDO_GEOMETRY. */
  Struct getFduGeometry(int fduId);

  /** Cursor row from fdu_geometry_gets(?, ?). Column shape is left to caller. */
  record FduGeometryRow(java.util.Map<String, Object> columns) {}

  /** fdu_geometry_gets(?, ?) where the OUT is a CURSOR. */
  List<FduGeometryRow> getFduGeometry(int fspId, int fspAmendmentNumber);
}
