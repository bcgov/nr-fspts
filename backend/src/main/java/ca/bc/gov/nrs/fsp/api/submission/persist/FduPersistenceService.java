package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlConversionException;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.WKTWriter;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Increment 2 of XML-submission persistence: writes each FDU's
 * header, geometry, and licence rows for the (fspId, amendmentNumber)
 * being submitted.
 *
 * <p>Open assumptions documented here so future maintainers know what
 * to verify against the real DB:
 * <ul>
 *   <li><b>Idempotency:</b> this service does NOT delete pre-existing
 *       FDU rows for the same (fspId, amendmentNumber) before
 *       inserting. If the amendment is already populated, the unique
 *       constraint on FDU_ID will throw and the whole transaction
 *       rolls back. Callers should treat that as "amendment already
 *       persisted; pick a new amendment number".</li>
 *   <li><b>FEATURE_AREA / FEATURE_PERIMETER:</b> computed from the JTS
 *       Polygon in the source SRS. BC Albers (EPSG:42102/3005) is
 *       metric so area-in-m² ÷ 10 000 = hectares and length-in-m ÷
 *       1 000 = km. For non-metric submissions these numbers will
 *       need a unit-aware conversion.</li>
 *   <li><b>FEATURE_CLASS_SKEY:</b> looked up by name = "Forest
 *       Development Unit" — confirm with DBAs.</li>
 *   <li><b>SRID mapping:</b> the srsName trailing integer is passed
 *       straight through as SDO_SRID. EPSG codes map 1:1 to Oracle
 *       SRIDs for the BC Albers codes (42102, 3005, 4326, the UTM
 *       BC family) but if production submissions ever carry a
 *       non-EPSG urn we'll need a mapping table.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FduPersistenceService {

  private final GmlGeometryConverter geometryConverter;
  private final FduWriteDao fduWriteDao;
  private static final WKTWriter WKT_WRITER = new WKTWriter();

  public void persist(ForestStewardshipPlanType plan, long fspId, long amendmentNumber, String userId) {
    FDUAssociationType fduList = plan.getFduList();
    if (fduList == null || fduList.getFdu() == null || fduList.getFdu().isEmpty()) {
      log.info("No FDUs in submission for fspId={} amendment={} — skipping FDU writes",
          fspId, amendmentNumber);
      return;
    }

    long featureClassSkey = fduWriteDao.lookupFduFeatureClassSkey();
    List<FDUType> fdus = fduList.getFdu();
    log.info("Persisting {} FDU(s) for fspId={} amendment={}", fdus.size(), fspId, amendmentNumber);

    // Clear any rows fsp_common_db.fdu_copy forward-copied from the
    // prior amendment (header + licence, no geometry) before inserting
    // the XML's FDUs. Without this the amendment ends up with the
    // copied FDUs AND the new ones — and because the copied fdu_ids
    // still join to the prior amendment's geometry, FSP_600_MAP.GET
    // raises ORA-01422 ("exact fetch returns more than requested
    // number of rows") on the next read.
    int cleared = fduWriteDao.clearFdusForAmendment(fspId, amendmentNumber);
    if (cleared > 0) {
      log.info("Cleared {} pre-existing FDU header(s) on fspId={} amendment={} before submission writes",
          cleared, fspId, amendmentNumber);
    }

    for (FDUType fdu : fdus) {
      persistOne(fdu, fspId, amendmentNumber, featureClassSkey, userId);
    }
  }

  private void persistOne(
      FDUType fdu, long fspId, long amendmentNumber, long featureClassSkey, String userId) {
    Geometry jts;
    int srid;
    try {
      jts = geometryConverter.toJts(fdu.getExtentOf());
      srid = geometryConverter.sridFromExtent(fdu.getExtentOf());
    } catch (GmlConversionException e) {
      throw new IllegalStateException(
          "FDU '" + fdu.getFduName() + "' geometry could not be converted: " + e.getMessage(), e);
    }

    long fduId = fduWriteDao.nextFduId();
    // Normalize ring winding before WKT — Oracle's MOF_SPATIAL_VALIDATION
    // raises ORA-13367 on CW exterior rings, which some source files
    // produce. See GeometryOrientationNormalizer for the why.
    jts = GeometryOrientationNormalizer.normalize(jts);
    String wkt = WKT_WRITER.write(jts);
    // BC Albers (EPSG:42102, 3005) is metric — JTS area/length are in
    // square metres / metres. Convert to ha / km for the table units.
    double areaHa = jts.getArea() / 10_000.0;
    double perimeterKm = jts.getLength() / 1_000.0;

    fduWriteDao.insertFduHeader(fspId, amendmentNumber, fduId, fdu.getFduName(), userId);
    fduWriteDao.insertFduGeometry(
        fspId, amendmentNumber, fduId, featureClassSkey, wkt, srid, areaHa, perimeterKm, userId);

    if (fdu.getLicenceList() != null && fdu.getLicenceList().getLicenceNumber() != null) {
      for (String licenceNumber : fdu.getLicenceList().getLicenceNumber()) {
        if (licenceNumber != null && !licenceNumber.isBlank()) {
          fduWriteDao.insertFduLicence(fspId, amendmentNumber, fduId, licenceNumber, userId);
        }
      }
    }
  }
}
