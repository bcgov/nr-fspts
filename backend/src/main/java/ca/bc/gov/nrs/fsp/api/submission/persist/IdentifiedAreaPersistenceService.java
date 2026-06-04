package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.IdentifiedAreaWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlConversionException;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.WKTWriter;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Increment 3 of XML-submission persistence: writes each Identified
 * Area's header + geometry for the (fspId, amendmentNumber) being
 * submitted. Same conventions as {@link FduPersistenceService}, minus
 * the licence cross-reference (IAs don't have licences). Header
 * carries the FRPA/FPPR legislation type instead.
 *
 * <p>Same open assumptions documented on FduPersistenceService apply
 * (FEATURE_CLASS_SKEY lookup criteria, idempotency on re-submit,
 * metric area/perimeter, EPSG-style srsName).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class IdentifiedAreaPersistenceService {

  private final GmlGeometryConverter geometryConverter;
  private final IdentifiedAreaWriteDao writeDao;
  private static final WKTWriter WKT_WRITER = new WKTWriter();

  public void persist(
      ForestStewardshipPlanType plan, long fspId, long amendmentNumber, String userId) {
    IdentifiedAreaAssociationType list = plan.getIdentifiedAreasList();
    if (list == null || list.getIdentifiedArea() == null || list.getIdentifiedArea().isEmpty()) {
      log.info("No identified areas in submission for fspId={} amendment={} — skipping",
          fspId, amendmentNumber);
      return;
    }

    long featureClassSkey = writeDao.lookupIdentifiedAreaFeatureClassSkey();
    List<IdentifiedAreaType> areas = list.getIdentifiedArea();
    log.info("Persisting {} identified area(s) for fspId={} amendment={}",
        areas.size(), fspId, amendmentNumber);

    for (IdentifiedAreaType area : areas) {
      persistOne(area, fspId, amendmentNumber, featureClassSkey, userId);
    }
  }

  private void persistOne(
      IdentifiedAreaType area,
      long fspId,
      long amendmentNumber,
      long featureClassSkey,
      String userId) {
    Geometry jts;
    int srid;
    try {
      jts = geometryConverter.toJts(area.getExtentOf());
      srid = geometryConverter.sridFromExtent(area.getExtentOf());
    } catch (GmlConversionException e) {
      throw new IllegalStateException(
          "Identified area '" + area.getIdentifiedAreaName()
              + "' geometry could not be converted: " + e.getMessage(), e);
    }

    long iaId = writeDao.nextIdentifiedAreaId();
    String wkt = WKT_WRITER.write(jts);
    double areaHa = jts.getArea() / 10_000.0;
    double perimeterKm = jts.getLength() / 1_000.0;

    writeDao.insertIdentifiedAreaHeader(
        fspId,
        amendmentNumber,
        iaId,
        area.getLegislationTypeCode(),
        area.getIdentifiedAreaName(),
        userId);
    writeDao.insertIdentifiedAreaGeometry(
        fspId, amendmentNumber, iaId, featureClassSkey, wkt, srid, areaHa, perimeterKm, userId);
  }
}
