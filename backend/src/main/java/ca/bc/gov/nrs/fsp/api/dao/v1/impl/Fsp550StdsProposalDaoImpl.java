package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class Fsp550StdsProposalDaoImpl extends AbstractStoredProcedureDao
    implements Fsp550StdsProposalDao {

  // 13 positional params on FSP_550_STDS_PROPOSAL.GET — see the
  // package body (R__06400_FSP_550_STDS_PROPOSAL.sql) for the full
  // signature. Set `p_display_fsp_org_clients = 'Y'` so the org and
  // client cursors are scoped to the FSP rather than the regime
  // (matches the legacy FSP250 view behaviour).
  private static final int PARAM_COUNT = 13;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp550StdsProposalDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result get(String regimeId, String fspId, String amendmentNumber,
                    String displayFspOrgClients) {
    return executeCall(CALL,
        cs -> {
          cs.setString(1, regimeId);                  // p_standards_regime_id IN
          cs.setString(2, "");                        // p_stocking_layer_code IN
          cs.setString(3, "");                        // p_standards_regime_layer_id IN
          setInOutString(cs, 4, "");                  // p_error_message INOUT
          registerOutCursor(cs, 5);                   // p_standards_cursor INOUT
          registerOutCursor(cs, 6);                   // p_org_unit_cursor INOUT
          registerOutCursor(cs, 7);                   // p_client_cursor INOUT
          registerOutCursor(cs, 8);                   // p_attachment_cursor INOUT
          registerOutCursor(cs, 9);                   // p_bgc_zone_cursor INOUT
          cs.setString(10, fspId);                    // p_fsp_id IN
          cs.setString(11, amendmentNumber);          // p_fsp_amendment_number IN
          setInOutString(cs, 12, "");                 // p_fsp_status_code INOUT
          cs.setString(13, displayFspOrgClients);     // p_display_fsp_org_clients IN
        },
        cs -> {
          // Header cursor is single-row; map by position 1..N matching
          // the proc body's SELECT list. We surface a subset — extra
          // columns (layer flags, layer ids, sub-class fields, audit
          // user/revision count) are intentionally skipped here.
          List<Header> headers = readCursor(cs, 5, rs -> new Header(
              rs.getString(1),   // standards_regime_id
              rs.getString(2),   // fsp_id_list
              rs.getString(3),   // standards_regime_name
              rs.getString(4),   // standards_objective
              rs.getString(5),   // regulation_code
              rs.getString(6),   // regulation_description
              rs.getString(7),   // geographic_description
              rs.getString(8),   // standards_regime_status_code
              rs.getString(9),   // status_description
              rs.getString(10),  // effective_date
              rs.getString(11),  // expiry_date
              rs.getString(12),  // regen_obligation_ind
              rs.getString(13),  // regen_delay_offset_yrs
              rs.getString(14),  // free_growing_early_offset_yrs
              rs.getString(15),  // free_growing_late_offset_yrs
              rs.getString(16),  // no_regen_early_offset_yrs
              rs.getString(17),  // no_regen_late_offset_yrs
              rs.getString(18),  // additional_standards
              // skip reject_note (19)
              rs.getString(20),  // submitted_by_userid
              // skip standards_used_by_ssu_ind (21)
              rs.getString(36),  // mof_default_standard_ind  (note: mapping below)
              rs.getString(37),  // standards_amend_number    (note: mapping below)
              rs.getString(35),  // revision_count — needed for SAVE optimistic-lock
              // Layer flag/id pairs (22-31): Y/N indicator + the
              // standards_regime_layer_id for each layer the proc
              // would otherwise return as a separate sub-cursor.
              rs.getString(22),  // layer_single
              rs.getString(23),  // layer_single_id
              rs.getString(24),  // layer_1
              rs.getString(25),  // layer_1_id
              rs.getString(26),  // layer_2
              rs.getString(27),  // layer_2_id
              rs.getString(28),  // layer_3
              rs.getString(29),  // layer_3_id
              rs.getString(30),  // layer_4
              rs.getString(31)   // layer_4_id
              // skip stocking_layer_code (32), standards_regime_layer_id (33),
              // update_userid (34) — not surfaced yet
          ));
          List<OrgUnitRow> districts = readCursor(cs, 6, rs -> new OrgUnitRow(
              rs.getString(2),   // org_unit_no
              rs.getString(3),   // org_unit_code
              rs.getString(4)    // org_unit_name
          ));
          List<ClientRow> clients = readCursor(cs, 7, rs -> new ClientRow(
              rs.getString(2),   // client_number
              rs.getString(3),   // client_name
              rs.getString(4)    // client_acronym
          ));
          // Cursor 8 (attachments) is opened by the proc but never read —
          // the SS Attachments UI was dropped, and the Oracle JDBC
          // driver closes the unread REF CURSOR when the statement
          // closes, so leaving it un-read is safe.
          List<BgcZoneRow> bgcZones = readCursor(cs, 9, rs -> new BgcZoneRow(
              rs.getString(2),   // standard_regime_site_series_id
              rs.getString(3),   // bgc_zone_code
              rs.getString(4),   // bgc_subzone_code
              rs.getString(5),   // bgc_variant
              rs.getString(6),   // bgc_phase
              rs.getString(7),   // bec_site_series_cd
              rs.getString(8),   // bec_site_series_phase_cd
              rs.getString(9),   // bec_seral
              // update_userid (10) — not surfaced
              rs.getString(11)   // revision_count
          ));
          // Header cursor is one row but defensively handle empty.
          Header header = headers.isEmpty() ? null : headers.get(0);
          String error = cs.getString(4);
          Result r = new Result(header, districts, clients, bgcZones, error);
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, error);
          return r;
        });
  }

  @Override
  public String getRevisionCount(String regimeId) {
    try {
      Long n = jdbcTemplate.queryForObject(
          "SELECT revision_count FROM standards_regime WHERE standards_regime_id = ?",
          Long.class, Long.parseLong(regimeId));
      return n == null ? null : n.toString();
    } catch (EmptyResultDataAccessException e) {
      return null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  // -----------------------------------------------------------------
  // Write paths — added for the XML-submission Phase 2 persistence work.
  // The legacy ESF agent wired these procs through pkgdefinitions; we
  // mirror that param order. INOUT params (regime id, revision count)
  // come back populated by the proc on insert.
  // -----------------------------------------------------------------

  private static final int SAVE_PARAM_COUNT = 20;
  private static final String SAVE_CALL = callSql(PACKAGE_NAME, PROCEDURE_SAVE, SAVE_PARAM_COUNT);
  private static final int SAVE_BGC_PARAM_COUNT = 13;
  private static final String SAVE_BGC_CALL =
      callSql(PACKAGE_NAME, PROCEDURE_SAVE_BGC_ITEM, SAVE_BGC_PARAM_COUNT);

  @Override
  public SaveResult save(SaveRequest req) {
    return executeCall(SAVE_CALL,
        cs -> {
          setInOutString(cs, 1, req.standardsRegimeId());        // INOUT
          cs.setString(2, req.fspId());                           // IN
          cs.setString(3, req.fspAmendmentNumber());              // IN
          cs.setString(4, req.standardsRegimeName());             // IN
          cs.setString(5, req.standardsObjective());              // IN
          cs.setString(6, req.regulationCode());                  // IN
          cs.setString(7, req.geographicDescription());           // IN
          cs.setString(8, req.standardsRegimeStatusCode());       // IN
          cs.setString(9, req.effectiveDate());                   // IN
          cs.setString(10, req.expiryDate());                     // IN
          cs.setString(11, req.regenObligationInd());             // IN
          cs.setString(12, req.regenDelayOffsetYrs());            // IN
          cs.setString(13, req.freeGrowingEarlyOffsetYrs());      // IN
          cs.setString(14, req.freeGrowingLateOffsetYrs());       // IN
          cs.setString(15, req.noRegenEarlyOffsetYrs());          // IN
          cs.setString(16, req.noRegenLateOffsetYrs());           // IN
          cs.setString(17, req.additionalStandards());            // IN
          cs.setString(18, req.updateUserid());                   // IN
          setInOutString(cs, 19, req.revisionCount());            // INOUT
          setInOutString(cs, 20, "");                             // INOUT p_error_message
        },
        cs -> {
          SaveResult r = new SaveResult(cs.getString(1), cs.getString(19), cs.getString(20));
          throwIfError(PACKAGE_NAME, PROCEDURE_SAVE, r.errorMessage());
          return r;
        });
  }

  @Override
  public SaveBgcResult saveBgcItem(SaveBgcRequest req) {
    return executeCall(SAVE_BGC_CALL,
        cs -> {
          setInOutString(cs, 1, req.stdsRegimeSiteSeriesId());    // INOUT
          cs.setString(2, req.standardsRegimeId());               // IN
          setInOutString(cs, 3, req.bgcZoneCode());               // INOUT
          setInOutString(cs, 4, req.bgcSubzoneCode());            // INOUT
          setInOutString(cs, 5, req.bgcVariant());                // INOUT
          setInOutString(cs, 6, req.bgcPhase());                  // INOUT
          setInOutString(cs, 7, req.becSiteSeriesCd());           // INOUT
          setInOutString(cs, 8, req.becSiteSeriesPhaseCd());      // INOUT
          setInOutString(cs, 9, req.becSeral());                  // INOUT
          cs.setString(10, req.updateUserid());                   // IN
          cs.setString(11, req.revisionCount());                  // IN
          cs.setString(12, req.standardsRevisionCount());         // IN
          setInOutString(cs, 13, "");                             // INOUT p_error_message
        },
        cs -> {
          SaveBgcResult r = new SaveBgcResult(cs.getString(1), cs.getString(13));
          throwIfError(PACKAGE_NAME, PROCEDURE_SAVE_BGC_ITEM, r.errorMessage());
          return r;
        });
  }

  private static final int REMOVE_BGC_PARAM_COUNT = 6;
  private static final String REMOVE_BGC_CALL =
      callSql(PACKAGE_NAME, PROCEDURE_REMOVE_BGC_ITEM, REMOVE_BGC_PARAM_COUNT);

  @Override
  public void removeBgcItem(RemoveBgcRequest req) {
    executeCall(REMOVE_BGC_CALL,
        cs -> {
          cs.setString(1, req.stdsRegimeSiteSeriesId());       // IN
          cs.setString(2, req.standardsRegimeId());            // IN
          cs.setString(3, req.updateUserid());                 // IN
          cs.setString(4, req.revisionCount());                // IN
          cs.setString(5, req.standardsRevisionCount());       // IN
          setInOutString(cs, 6, "");                           // INOUT p_error_message
        },
        cs -> {
          String error = cs.getString(6);
          throwIfError(PACKAGE_NAME, PROCEDURE_REMOVE_BGC_ITEM, error);
          return null;
        });
  }

  // FSP_550_STDS_PROPOSAL.COPY positional params (8):
  //   1. p_standards_regime_id INOUT — source id in, new id out
  //   2. p_fsp_id IN
  //   3. p_fsp_amendment_number IN
  //   4. p_org_unit_no IN — caller's session district (or "")
  //   5. p_client_number IN — caller's session client (or "")
  //   6. p_update_userid IN
  //   7. p_revision_count IN — source row's optimistic-lock token
  //   8. p_errors INOUT
  private static final int COPY_PARAM_COUNT = 8;
  private static final String COPY_CALL =
      callSql(PACKAGE_NAME, PROCEDURE_COPY, COPY_PARAM_COUNT);

  @Override
  public CopyResult copyRegime(CopyRequest req) {
    return executeCall(COPY_CALL,
        cs -> {
          setInOutString(cs, 1, req.sourceRegimeId());     // INOUT
          cs.setString(2, req.fspId());                     // IN
          cs.setString(3, req.fspAmendmentNumber());        // IN
          cs.setString(4, req.orgUnitNo());                 // IN
          cs.setString(5, req.clientNumber());              // IN
          cs.setString(6, req.updateUserid());              // IN
          cs.setString(7, req.revisionCount());             // IN
          setInOutString(cs, 8, "");                        // INOUT p_errors
        },
        cs -> {
          CopyResult r = new CopyResult(cs.getString(1), cs.getString(8));
          throwIfError(PACKAGE_NAME, PROCEDURE_COPY, r.errorMessage());
          return r;
        });
  }

}
