package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp900NotificationDesignateDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import ca.bc.gov.nrs.fsp.api.struct.v1.NotificationDesignate;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Manages the district auto-notification designate list. Wraps the
 * legacy FSP_900_NOTIFICATION_DESIGNATE package: GET reads designates
 * for an org unit, SAVE adds one (by IDIR username), REMOVE deletes
 * by designate id.
 *
 * <p>Display-name + email enrichment is done client-side after the
 * list renders — the page fires parallel FAM lookups in the background
 * so the table appears immediately rather than waiting on N upstream
 * round trips.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DistrictNotificationService {

  // Legacy convention — the IDIR column stores names with the AD
  // domain qualifier ("IDIR\MAVILLEN"); new inserts must match so
  // lookups, joins, and downstream queries find them.
  private static final String IDIR_PREFIX = "IDIR\\";

  private static final String PROC = "FSP_900_NOTIFICATION_DESIGNATE";

  private final Fsp900NotificationDesignateDao dao;

  public List<NotificationDesignate> getDesignates(String orgUnitNo) {
    Fsp900NotificationDesignateDao.GetResult result = dao.get(nz(orgUnitNo));
    throwIfError(result.errorMessage(), "GET");
    return result.rows().stream()
        .map(r -> NotificationDesignate.builder()
            .designateId(r.designateId())
            .designateIdir(r.designateIdir())
            .build())
        .toList();
  }

  public void addDesignate(String orgUnitNo, String designateIdir) {
    String entryUserid = nz(RequestUtil.getCurrentIdir());
    String error = dao.save(nz(orgUnitNo), withIdirPrefix(designateIdir), entryUserid);
    throwIfError(error, "SAVE");
  }

  private static String withIdirPrefix(String raw) {
    String value = nz(raw).trim();
    if (value.isEmpty()) return value;
    return value.toUpperCase().startsWith(IDIR_PREFIX) ? value : IDIR_PREFIX + value;
  }

  public void removeDesignate(String designateId) {
    String error = dao.remove(nz(designateId));
    throwIfError(error, "REMOVE");
  }

  private static void throwIfError(String errorMessage, String action) {
    if (errorMessage != null && !errorMessage.isBlank()) {
      throw new StoredProcedureException(PROC, action, errorMessage);
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
