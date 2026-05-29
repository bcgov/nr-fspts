package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps Oracle package FSP_900_NOTIFICATION_DESIGNATE (legacy:
 * data/manager/Fsp900DistrictNotificationDataManager.java). Maintains
 * the list of IDIR usernames the district auto-notification email
 * should CC for each org unit.
 *
 * <p>Three procs: GET reads the designate list for an org unit, SAVE
 * adds one designate (IDIR username), REMOVE deletes by designate id.</p>
 */
public interface Fsp900NotificationDesignateDao {

  String PACKAGE_NAME = "FSP_900_NOTIFICATION_DESIGNATE";

  /** One row from the GET cursor — designate id + IDIR username. */
  record DesignateRow(String designateId, String designateIdir) {}

  record GetResult(String errorMessage, List<DesignateRow> rows) {}

  /** GET(p_org_unit_no, OUT errors, OUT cursor). */
  GetResult get(String orgUnitNo);

  /** SAVE(p_org_unit_no, p_designate_idir, p_entry_userid, OUT errors). */
  String save(String orgUnitNo, String designateIdir, String entryUserid);

  /** REMOVE(p_designate_id, OUT errors). */
  String remove(String designateId);
}
