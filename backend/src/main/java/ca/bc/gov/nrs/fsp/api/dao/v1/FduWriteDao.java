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

  /**
   * Delete the {@code (fduId, forestFileId)} row from {@code FDU_LICENCE_XREF}.
   * No-op if the row doesn't exist. Used by the licence-edit dialog.
   */
  void removeFduLicence(long fspId, long amendmentNumber, long fduId, String forestFileId);

  /**
   * Existence check against {@code THE.PROV_FOREST_USE} — the canonical
   * provincial forest-file registry. Returns {@code true} when the id
   * resolves to a row; used to validate user-supplied licence numbers
   * before they hit {@link #insertFduLicence}.
   */
  boolean licenceExists(String forestFileId);

  /**
   * Returns the current {@code FSP_STATUS_CODE} for the given FSP +
   * amendment, or {@code null} if no row matches. The licence-edit
   * service uses this to gate by status (DFT writeable by submitter,
   * APP writeable by admin only).
   */
  String findFspStatus(long fspId, long amendmentNumber);

  /**
   * Lightweight check that the given {@code forestFileId} is already
   * attached to the given {@code fduId} on this FSP/amendment. Lets the
   * service skip re-inserting duplicates and report them as no-ops.
   */
  boolean fduHasLicence(long fspId, long amendmentNumber, long fduId, String forestFileId);

  /**
   * Returns the highest {@code FSP_AMENDMENT_NUMBER} on the given FSP
   * whose status is APP (Approved) or INE (In Effect), or {@code null}
   * if none exists. Mirrors the proc-side
   * {@code FSP_COMMON_DB.get_max_approved_amendment} which
   * {@code fsp_create_amendment} uses to template a new amendment row
   * from. Used by the Replacement pre-check — a Replacement cannot
   * proceed without an existing APP/INE amendment to template from,
   * and the proc silently inserts 0 rows in that case before exploding
   * downstream with NO_DATA_FOUND inside fsp_status_update.
   */
  Long findMaxApprovedAmendmentNumber(long fspId);

  /**
   * Deletes every FDU header + licence-xref row for the given
   * {@code (fspId, amendmentNumber)} tuple — used by the XML
   * submission path to wipe the skeleton rows
   * {@code fsp_common_db.fdu_copy} forward-copies during
   * {@code AMEND}/{@code REPLACE}, so the new FDU state from the XML
   * is the only thing left. The proc doesn't copy geometry forward
   * (only headers + licences), so {@code forest_development_unit_geom}
   * gets cleared too as a defensive sweep in case any stale rows landed
   * via an earlier failed run.
   *
   * <p>Ordering matters: licence_xref → fdu_geom → FDU header (the
   * latter is the parent of the other two FKs).
   *
   * @return number of FDU header rows deleted.
   */
  int clearFdusForAmendment(long fspId, long amendmentNumber);

  /**
   * Deletes the most recent {@code fsp_status_code='UPD'} row from
   * {@code fsp_status_history} for the given {@code (fspId,
   * amendmentNumber)}. {@code fsp_common_db.fsp_update} unconditionally
   * inserts an UPD audit row on every SAVE — fine for UI tab edits
   * (one event per click) but noisy on the XML submission path where
   * REPLACE/AMEND already emitted the "Draft" event and the SAVE that
   * follows is just bookkeeping. Mirrors the legacy
   * {@code FSP_300_INFORMATION.update_replace} / {@code update_amend}
   * behaviour where the single DFT row stands alone.
   *
   * <p>Surgical: deletes only the latest UPD row (the one our SAVE
   * just inserted) so pre-existing UPD audit history on the amendment
   * is untouched.
   *
   * @return number of rows deleted (0 or 1).
   */
  int deleteLatestUpdHistoryRow(long fspId, long amendmentNumber);

  /**
   * Marks every prior APP/INE amendment on the given FSP as Retired,
   * matching the legacy behaviour seen when a Replacement is
   * submitted. Two writes per affected amendment:
   *
   * <ol>
   *   <li>INSERT an {@code fsp_status_history} row with
   *       {@code fsp_status_code='RET'} and status_comment
   *       {@code 'Retired Issued'} — same comment text the proc-side
   *       {@code fsp_status_cancel} uses
   *       (R__06412_FSP_COMMON_DB.sql:2346).</li>
   *   <li>UPDATE the {@code forest_stewardship_plan} row's
   *       {@code fsp_status_code} to {@code 'RET'} so search/list
   *       views reflect the new state.</li>
   * </ol>
   *
   * <p>The current (new replacement) amendment is excluded by id so
   * the freshly-created DFT row stays untouched. No-op when the FSP
   * has no APP/INE amendments to retire.
   *
   * @return number of amendment rows retired.
   */
  int retirePriorApprovedAmendments(long fspId, long currentAmendmentNumber, String userId);
}
