package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduLicencesUpdate;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduLicencesUpdated;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduList;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
      String fspId, long fduId, FduLicencesUpdate payload) {
    // Resolve the amendment to write against — same path the read uses
    // so we can't be operating on a different amendment than the user
    // is looking at.
    long fspIdLong = Long.parseLong(fspId);
    Fsp600MapDao.Result current = dao.get(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles());
    long amendmentNumber = current.fduAmendmentNumber() == null
        ? 0L
        : Long.parseLong(current.fduAmendmentNumber());

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
