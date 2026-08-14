package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.submission.persist.GeometryOrientationNormalizer;
import ca.bc.gov.nrs.fsp.api.validation.FspFieldRules;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduCreateRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduCreated;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduLicencesUpdate;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduLicencesUpdated;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduList;
import ca.bc.gov.nrs.fsp.api.struct.v1.LicenceExistsResponse;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.WKTWriter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Read wrapper for FSP_600_MAP.GET — surfaces the per-FDU rows the
 * FDU/Map screen needs. Audit-user context (client/role) is pulled
 * from the current JWT so the proc's access gate (delegated to
 * fsp_tombstone.get) sees the same identity as every other FSP_* DAO.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FduService {

  private final Fsp600MapDao dao;
  private final FduWriteDao writeDao;
  private final FspAccessGuard accessGuard;
  private final FduGeometryInputParser geometryParser;

  /** {@code FOREST_DEVELOPMENT_UNIT.FDU_NAME VARCHAR2(120)}. */
  private static final int MAX_FDU_NAME_LEN = FspFieldRules.MAX_FDU_NAME_LEN;

  public FduList getFdus(String fspId) {
    Fsp600MapDao.Result r = dao.get(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles());
    List<FduList.Fdu> fdus = r.fdus().stream()
        .map(f -> new FduList.Fdu(f.fduId(), f.fduName(), f.licences()))
        .toList();
    return new FduList(r.fduAmendmentNumber(), fdus);
  }

  /**
   * Apply additions / removals to an FDU's licence list. Gated by the shared
   * content-edit fence ({@code FspAccessGuard.assertContentEditable}):
   * Administrators may edit in any status except Approved / In-Effect /
   * Submitted; Submitters only while Draft; everyone else is denied.
   *
   * <p>Every id in {@code add} is validated against {@code PROV_FOREST_USE}
   * before any insert runs; an invalid id rejects the whole batch with
   * 400 so the user can fix and resubmit without partial state.
   * Already-attached ids are silently skipped and surfaced in the
   * response's {@code skippedAlreadyPresent} count.
   *
   * @return refreshed licence list for the FDU, plus per-bucket counts.
   */
  @Transactional
  public FduLicencesUpdated updateLicences(
      String fspId, long fduId, String amendmentNumberParam, FduLicencesUpdate payload) {
    long fspIdLong = Long.parseLong(fspId);
    // Use the amendment the user is VIEWING (passed by the SPA). Only when it's
    // absent do we fall back to resolving via FSP_600_MAP.GET — and that
    // resolution follows the shared-geometry fdu_id join, so for a draft
    // amendment that reuses the original's FDU geometry it lands on the
    // ORIGINAL (approved/in-effect) amendment and wrongly denies a submitter
    // editing the draft ("can't be edited directly in its current status").
    long amendmentNumber;
    if (amendmentNumberParam != null && !amendmentNumberParam.isBlank()) {
      amendmentNumber = Long.parseLong(amendmentNumberParam.trim());
    } else {
      Fsp600MapDao.Result current = dao.get(
          fspId,
          RequestUtil.getCurrentClientNumber(),
          RequestUtil.getCurrentLegacyRoles());
      amendmentNumber = current.fduAmendmentNumber() == null
          ? 0L
          : Long.parseLong(current.fduAmendmentNumber());
    }

    // Content-edit fence (ownership + status), the same rule as every other
    // FSP edit: Administrators can't edit APP/INE/SUB plans; Submitters only
    // Drafts. Replaces FDU's former DFT-or-APP-admin exception.
    accessGuard.assertContentEditable(fspId, String.valueOf(amendmentNumber));

    Set<String> addSet = normalise(payload == null ? null : payload.getAdd());
    Set<String> removeSet = normalise(payload == null ? null : payload.getRemove());
    // An id that appears on both sides is treated as a no-op — easier
    // to write the dialog code than to error here, and the net effect
    // is the same as not posting it at all.
    addSet.removeAll(removeSet);

    // Validate every add up-front so an invalid one fails the entire
    // request with 400 — no partial state.
    List<String> invalid = new ArrayList<>();
    for (String id : addSet) {
      if (!writeDao.licenceExists(id)) invalid.add(id);
    }
    if (!invalid.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Unknown licence number(s): " + String.join(", ", invalid));
    }

    String userId = RequestUtil.getCurrentAuditUserId();
    int added = 0;
    int skipped = 0;
    for (String id : addSet) {
      if (writeDao.fduHasLicence(fspIdLong, amendmentNumber, fduId, id)) {
        skipped++;
        continue;
      }
      writeDao.insertFduLicence(fspIdLong, amendmentNumber, fduId, id, userId);
      added++;
    }
    int removed = 0;
    for (String id : removeSet) {
      writeDao.removeFduLicence(fspIdLong, amendmentNumber, fduId, id);
      removed++;
    }

    log.info("FDU {} licences updated by {} on FSP {}/{} — added={} removed={} skipped={}",
        fduId, userId, fspId, amendmentNumber, added, removed, skipped);

    // Re-read the FDU row so the response carries the post-update list
    // for the SPA. Cheap — same proc the page already calls on load.
    Fsp600MapDao.Result refreshed = dao.get(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles());
    List<String> updated = refreshed.fdus().stream()
        .filter(r -> r.fduId() != null && Long.toString(fduId).equals(r.fduId()))
        .findFirst()
        .map(r -> splitLicences(r.licences()))
        .orElse(Collections.emptyList());
    return new FduLicencesUpdated(updated, added, removed, skipped);
  }

  /**
   * Add one FDU to the FSP/amendment — name, boundary, and optional licences.
   *
   * <p>Gated by the same content-edit fence as every other FSP write, so a
   * Submitter can add FDUs to a Draft only and needs an amendment on an
   * approved plan.
   *
   * <p>Geometry is <b>required</b>, and that is deliberate rather than
   * incidental: {@code fsp_common_db.has_new_fdu_spatial} — the function
   * gating "FDUs modified" on submit — counts FDU <em>header</em> rows and
   * never inspects geometry, so a header-only FDU would let a plan be
   * submitted claiming FDU changes with no spatial data behind them. Same
   * shape as the MAP-attachment quirk that rule was hardened against.
   *
   * <p>Ordering matters: everything that can fail is checked before the first
   * insert, because the three writes (header, geometry, licences) are
   * separate statements and a half-written FDU is worse than a rejected one.
   */
  @Transactional
  public FduCreated addFdu(String fspId, String amendmentNumberParam, FduCreateRequest body) {
    if (body == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A request body is required.");
    }
    long fspIdLong = Long.parseLong(fspId);
    long amendmentNumber = resolveAmendment(fspId, amendmentNumberParam);
    accessGuard.assertContentEditable(fspId, String.valueOf(amendmentNumber));

    String fduName = body.getFduName() == null ? "" : body.getFduName().trim();
    if (fduName.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "FDU name is required.");
    }
    if (fduName.length() > MAX_FDU_NAME_LEN) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "FDU name must be " + MAX_FDU_NAME_LEN + " characters or fewer (got "
              + fduName.length() + ").");
    }
    // Uniqueness within the amendment — the proc raises FSP.DUPLICATE.FDU.NAME
    // on the second insert, and the comparison there is NLS_UPPER-based.
    Fsp600MapDao.Result existing = dao.get(
        fspId, RequestUtil.getCurrentClientNumber(), RequestUtil.getCurrentLegacyRoles());
    boolean duplicate = existing.fdus().stream()
        .map(Fsp600MapDao.FduRow::fduName)
        .filter(java.util.Objects::nonNull)
        .anyMatch(n -> n.trim().equalsIgnoreCase(fduName));
    if (duplicate) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "An FDU named \"" + fduName + "\" already exists on this plan.");
    }

    // Parse + validate + reproject + measure before anything is written.
    FduGeometryInputParser.ParsedGeometry parsed =
        geometryParser.parse(body.getGeometry(), body.getSrid());

    Set<String> licences = normalise(body.getLicenceNumbers());
    List<String> invalid = new ArrayList<>();
    for (String id : licences) {
      if (!writeDao.licenceExists(id)) invalid.add(id);
    }
    if (!invalid.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
          "Unknown licence number(s): " + String.join(", ", invalid));
    }

    // Oracle's MOF_SPATIAL_VALIDATION raises ORA-13367 on clockwise exterior
    // rings, which plenty of source files produce — normalise before WKT.
    Geometry normalised = GeometryOrientationNormalizer.normalize(parsed.geometry());
    String wkt = new WKTWriter().write(normalised);

    String userId = RequestUtil.getCurrentAuditUserId();
    long fduId = writeDao.nextFduId();
    writeDao.insertFduHeader(fspIdLong, amendmentNumber, fduId, fduName, userId);
    writeDao.insertFduGeometry(
        fspIdLong,
        amendmentNumber,
        fduId,
        writeDao.lookupFduFeatureClassSkey(),
        wkt,
        parsed.srid(),
        parsed.areaHa(),
        parsed.perimeterKm(),
        userId);
    for (String id : licences) {
      writeDao.insertFduLicence(fspIdLong, amendmentNumber, fduId, id, userId);
    }

    log.info("FDU {} \"{}\" added to FSP {}/{} by {} — {} ha, {} licence(s)",
        fduId, fduName, fspId, amendmentNumber, userId, parsed.areaHa(), licences.size());

    return new FduCreated(
        Long.toString(fduId),
        fduName,
        Long.toString(amendmentNumber),
        parsed.areaHa(),
        parsed.perimeterKm(),
        licences.size());
  }

  /**
   * Prefer the amendment the SPA says the user is VIEWING; only fall back to
   * FSP_600_MAP.GET when it's absent. That resolution follows the
   * shared-geometry fdu_id join, so on a draft amendment reusing the
   * original's geometry it lands on the ORIGINAL — which would then deny a
   * submitter editing the draft. Same trap {@link #updateLicences} documents.
   */
  private long resolveAmendment(String fspId, String amendmentNumberParam) {
    if (amendmentNumberParam != null && !amendmentNumberParam.isBlank()) {
      return Long.parseLong(amendmentNumberParam.trim());
    }
    Fsp600MapDao.Result current = dao.get(
        fspId, RequestUtil.getCurrentClientNumber(), RequestUtil.getCurrentLegacyRoles());
    return current.fduAmendmentNumber() == null
        ? 0L
        : Long.parseLong(current.fduAmendmentNumber());
  }

  /**
   * Existence check for a single licence number against PROV_FOREST_USE —
   * backs the Edit-licences dialog's Add-time validation. Normalises the
   * number the same way the DAO does so the answer matches what a later
   * batch update would accept. A blank number is reported as not-found.
   */
  public LicenceExistsResponse licenceExists(String licenceNumber) {
    String normalised =
        licenceNumber == null ? "" : licenceNumber.trim().toUpperCase();
    boolean exists = !normalised.isEmpty() && writeDao.licenceExists(normalised);
    return new LicenceExistsResponse(normalised, exists);
  }

  /** Trim, uppercase, dedupe, drop blanks. Order-preserving. */
  private static Set<String> normalise(List<String> raw) {
    Set<String> out = new LinkedHashSet<>();
    if (raw == null) return out;
    for (String s : raw) {
      if (s == null) continue;
      String t = s.trim().toUpperCase();
      if (!t.isEmpty()) out.add(t);
    }
    return out;
  }

  /** Split the comma-separated licence string the read DAO returns. */
  private static List<String> splitLicences(String csv) {
    if (csv == null || csv.isBlank()) return Collections.emptyList();
    List<String> out = new ArrayList<>();
    for (String part : csv.split(",")) {
      String t = part.trim();
      if (!t.isEmpty()) out.add(t);
    }
    return out;
  }
}
