package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
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
  public Result get(String regimeId, String fspId, String amendmentNumber) {
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
          cs.setString(13, "Y");                      // p_display_fsp_org_clients IN
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
              // skip no_regen_early_offset_yrs (16) and
              // no_regen_late_offset_yrs (17) — not surfaced yet
              rs.getString(18),  // additional_standards
              // skip reject_note (19)
              rs.getString(20),  // submitted_by_userid
              // skip standards_used_by_ssu_ind (21)
              rs.getString(36),  // mof_default_standard_ind  (note: mapping below)
              rs.getString(37),  // standards_amend_number    (note: mapping below)
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
              // update_userid (34), revision_count (35) — not surfaced yet
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
          List<AttachmentRow> attachments = readCursor(cs, 8, rs -> new AttachmentRow(
              rs.getString(2),   // standards_regime_attach_id
              rs.getString(3),   // attachment_name
              rs.getString(4),   // attachment_description
              rs.getString(5),   // mime_type_code
              rs.getString(6)    // file_size
          ));
          List<BgcZoneRow> bgcZones = readCursor(cs, 9, rs -> new BgcZoneRow(
              rs.getString(3),   // bgc_zone_code
              rs.getString(4),   // bgc_subzone_code
              rs.getString(5),   // bgc_variant
              rs.getString(6),   // bgc_phase
              rs.getString(7),   // bec_site_series_cd
              rs.getString(8),   // bec_site_series_phase_cd
              rs.getString(9)    // bec_seral
          ));
          // Header cursor is one row but defensively handle empty.
          Header header = headers.isEmpty() ? null : headers.get(0);
          String error = cs.getString(4);
          Result r = new Result(header, districts, clients, attachments, bgcZones, error);
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, error);
          return r;
        });
  }

  // Suppress unused-import warnings on Types — kept for readability if
  // the cursor map evolves to need OUT-only scalar registration later.
  @SuppressWarnings("unused")
  private static final int TYPES_VARCHAR_HINT = Types.VARCHAR;
}
