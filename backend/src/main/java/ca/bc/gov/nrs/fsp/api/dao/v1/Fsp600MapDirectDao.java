package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Direct-SQL replacement for {@code THE.FSP_600_MAP.GET} (see
 * {@link Fsp600MapDao}). The proc is unusable on any FSP whose FDU
 * geometry spans more than one amendment level, because its private
 * {@code get_fdu_amendment} function reads:
 *
 * <pre>
 *   SELECT UNIQUE fdug.fsp_amendment_number INTO fdu_amendment_number
 *     FROM forest_development_unit fdu, forest_development_unit_geom fdug
 *    WHERE fdu.fsp_id = p_fsp_id
 *      AND fdu.fsp_amendment_number = p_fsp_amendment_number
 *      AND fdu.fdu_id = fdug.fdu_id
 *      AND fdu.fsp_id = fdug.fsp_id;     -- no amendment predicate on fdug
 * </pre>
 *
 * and only handles {@code NO_DATA_FOUND}. {@code FDUG_PK} is
 * {@code (FSP_ID, FSP_AMENDMENT_NUMBER, FDU_ID)} and
 * {@code fsp_common_db.fdu_copy} carries FDU headers into a new amendment
 * <em>reusing the same {@code fdu_id} and deliberately not copying the
 * geometry</em>. So as soon as one amendment's FDU set has geometry living
 * at two different amendment levels — exactly what happens when
 * {@code FduService.addFdu} adds an FDU (header + geometry at the current
 * amendment) to an amendment whose other FDUs still point at the original's
 * geometry — that {@code SELECT ... INTO} returns two rows and the whole
 * {@code GET} dies with {@code ORA-01422} before the FDU cursor is even
 * opened. The legacy ESF path never hits it because
 * {@code fsp_submission_process} deletes and recreates every FDU for the
 * amendment, keeping geometry uniform.
 *
 * <p>This implementation ports the proc's three reads to plain SQL and
 * makes that one lookup deterministic ({@code MAX} instead of
 * {@code SELECT UNIQUE ... INTO}), which can never raise
 * {@code TOO_MANY_ROWS}. Where the proc worked, {@code MAX} returns the
 * same single value.
 *
 * <p>The read fence is <b>not</b> lost: the amendment resolution is a
 * verbatim port of {@code fsp_tombstone.get}'s "most recent amendment the
 * user may access" query, {@code fsp_tombstone.user_may_access} and all,
 * so ownership/role visibility stays in the database function it always
 * lived in. Same error keys as the proc, so
 * {@code RestExceptionHandler} maps them identically (403 on
 * {@code no_access_right}, empty list on {@code noRecordsFound}).
 */
public interface Fsp600MapDirectDao {

  /**
   * Same contract as {@link Fsp600MapDao#get(String, String, String)}:
   * resolves the most recent amendment the caller may access, then returns
   * that amendment's FDU rows plus the amendment its geometry lives at.
   */
  Fsp600MapDao.Result get(String fspId, String userClientNumber, String userRole);
}
