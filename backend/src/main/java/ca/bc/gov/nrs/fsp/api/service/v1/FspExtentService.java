package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduGeometryDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspExtentResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.sql.Struct;
import java.util.Optional;

/**
 * Computes the Map View extent string for an FSP + amendment. The
 * legacy app built this client-side via JTS over the polygons in
 * FSP_COMMON.fdu_geometry_gets — we keep the same data source but
 * decode SDO_GEOMETRY directly via JDBC attribute access (no JTS
 * dependency required, since we only need the bounding box, not the
 * geometry itself).
 *
 * Output format matches legacy {@code _spatial.jsp#getMapViewExtent}:
 * {@code minX,minY,maxX,maxY} with whatever scale Oracle returns. We
 * intentionally don't reformat or round — preserving the exact
 * BigDecimal precision keeps the URL byte-identical to legacy output
 * for the same data, which matters for any cached arcmaps results.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FspExtentService {

  // SDO_GEOMETRY attribute indices per Oracle Spatial reference:
  //   [0] SDO_GTYPE     NUMBER (DLLTT — leading digit is the dimension)
  //   [1] SDO_SRID      NUMBER (ignored — extent is in storage CRS, which
  //                             is what the arcmaps URL expects anyway)
  //   [2] SDO_POINT     SDO_POINT_TYPE (x, y, z) — populated only when
  //                                     the geometry is a single point
  //   [3] SDO_ELEM_INFO NUMBER varray (ignored — MBR doesn't care about
  //                                    ring topology, only ordinate min/max)
  //   [4] SDO_ORDINATES NUMBER varray (x1,y1[,z1],x2,y2[,z2],...)
  private static final int ATTR_GTYPE = 0;
  private static final int ATTR_POINT = 2;
  private static final int ATTR_ORDINATES = 4;

  private final FduGeometryDao fduGeometryDao;

  public FspExtentResponse getExtent(int fspId, int amendmentNumber) {
    BigDecimal minX = null, minY = null, maxX = null, maxY = null;

    for (FduGeometryDao.FduGeometryRow row : fduGeometryDao.getFduGeometry(fspId, amendmentNumber)) {
      // Cursor has a single SDO_GEOMETRY column whose label varies by
      // proc version — read positionally via the first map entry so we
      // aren't coupled to a specific column-label spelling.
      Object first = row.columns().values().stream().findFirst().orElse(null);
      if (!(first instanceof Struct geom)) continue;

      BigDecimal[] mbr = mbrFromSdoGeometry(geom);
      if (mbr == null) continue;
      minX = min(minX, mbr[0]);
      minY = min(minY, mbr[1]);
      maxX = max(maxX, mbr[2]);
      maxY = max(maxY, mbr[3]);
    }

    if (minX == null) {
      return FspExtentResponse.builder().extent(null).build();
    }
    return FspExtentResponse.builder()
        .extent(plain(minX) + "," + plain(minY) + "," + plain(maxX) + "," + plain(maxY))
        .build();
  }

  /**
   * Returns {minX, minY, maxX, maxY} for one SDO_GEOMETRY, or null if
   * the geometry is empty / decoding fails. We deliberately don't
   * throw — a single bad row shouldn't kill the whole MBR computation,
   * since the legacy was equally permissive (caught + logged via JTS).
   */
  private static BigDecimal[] mbrFromSdoGeometry(Struct geom) {
    try {
      Object[] attrs = geom.getAttributes();
      if (attrs == null || attrs.length <= ATTR_ORDINATES) return null;

      // SDO_POINT-only geometry: x/y in the POINT struct, ORDINATES null.
      if (attrs[ATTR_POINT] instanceof Struct pt) {
        Object[] p = pt.getAttributes();
        if (p != null && p.length >= 2 && p[0] instanceof Number nx && p[1] instanceof Number ny) {
          BigDecimal x = toBigDecimal(nx);
          BigDecimal y = toBigDecimal(ny);
          return new BigDecimal[] { x, y, x, y };
        }
      }

      if (!(attrs[ATTR_ORDINATES] instanceof java.sql.Array arr)) return null;
      Object raw;
      try {
        raw = arr.getArray();
      } finally {
        arr.free();
      }
      int len = java.lang.reflect.Array.getLength(raw);
      if (len == 0) return null;

      int dim = inferDimension(attrs[ATTR_GTYPE]);

      BigDecimal mnX = null, mnY = null, mxX = null, mxY = null;
      for (int i = 0; i + 1 < len; i += dim) {
        Object xo = java.lang.reflect.Array.get(raw, i);
        Object yo = java.lang.reflect.Array.get(raw, i + 1);
        if (!(xo instanceof Number nx) || !(yo instanceof Number ny)) continue;
        BigDecimal x = toBigDecimal(nx);
        BigDecimal y = toBigDecimal(ny);
        mnX = min(mnX, x);
        mnY = min(mnY, y);
        mxX = max(mxX, x);
        mxY = max(mxY, y);
      }

      if (mnX == null) return null;
      return new BigDecimal[] { mnX, mnY, mxX, mxY };
    } catch (SQLException ex) {
      log.warn("Skipping SDO_GEOMETRY row — failed to decode attributes", ex);
      return null;
    }
  }

  // SDO_GTYPE is DLLTT (D=dim, LL=LRS measure dim, TT=geometry type).
  // 2003 = 2D polygon, 3003 = 3D polygon. Leading digit = dim. Default
  // to 2 when we can't tell; ordinates are always at least 2-wide.
  private static int inferDimension(Object gtype) {
    if (gtype instanceof Number n) {
      int v = Math.abs(n.intValue());
      int d = v / 1000;
      if (d >= 2 && d <= 4) return d;
    }
    return 2;
  }

  private static BigDecimal toBigDecimal(Number n) {
    return (n instanceof BigDecimal bd) ? bd : new BigDecimal(n.toString());
  }

  private static BigDecimal min(BigDecimal a, BigDecimal b) {
    if (a == null) return b;
    if (b == null) return a;
    return a.compareTo(b) <= 0 ? a : b;
  }

  private static BigDecimal max(BigDecimal a, BigDecimal b) {
    if (a == null) return b;
    if (b == null) return a;
    return a.compareTo(b) >= 0 ? a : b;
  }

  // Drop trailing zeros so a value like 615135.6671000 doesn't render
  // as 615135.6671000000 in the URL — but preserve enough scale that
  // values like 1012145.0797 keep their precision (toPlainString won't
  // ever use scientific notation, unlike Double.toString).
  private static String plain(BigDecimal bd) {
    BigDecimal stripped = bd.stripTrailingZeros();
    // stripTrailingZeros leaves "1E+1" representations for ints; force
    // a non-negative scale so toPlainString returns plain integers.
    if (stripped.scale() < 0) stripped = stripped.setScale(0);
    return stripped.toPlainString();
  }

  public Optional<String> getExtentString(int fspId, int amendmentNumber) {
    return Optional.ofNullable(getExtent(fspId, amendmentNumber).getExtent());
  }
}
